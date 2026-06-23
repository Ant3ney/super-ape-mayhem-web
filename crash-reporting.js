(function () {
	'use strict';

	const SESSION_KEY = 'sam_crash_session_v1';
	const REPORT_KEY = 'sam_crash_report_v1';
	const PENDING_KEY = 'sam_crash_pending_v1';
	const MAX_EVENTS = 300;
	const MAX_REPORT_CHARS = 500000;
	const HEARTBEAT_INTERVAL_MS = 5000;
	const REPORT_EMAIL = 'anthonycavuoti@gmail.com';
	const REPORTER_VERSION = 3;

	let persistTimer = 0;
	let canvasAttached = false;
	let eventSequence = 0;

	function nowIso() {
		return new Date().toISOString();
	}

	function readJson(key) {
		try {
			const raw = window.localStorage.getItem(key);
			return raw ? JSON.parse(raw) : null;
		} catch (_error) {
			return null;
		}
	}

	function writeJson(key, value) {
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
			return true;
		} catch (_error) {
			return false;
		}
	}

	function removeKey(key) {
		try {
			window.localStorage.removeItem(key);
		} catch (_error) {}
	}

	function safeString(value) {
		if (value instanceof Error) {
			return value.stack || value.message || String(value);
		}
		if (typeof value === 'string') {
			return value;
		}
		try {
			return JSON.stringify(value);
		} catch (_error) {
			return String(value);
		}
	}

	function compactValue(value, depth) {
		if (value == null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
			return value;
		}
		if (value instanceof Error) {
			return {
				name: value.name,
				message: value.message,
				stack: value.stack || '',
			};
		}
		if (depth <= 0) {
			return safeString(value);
		}
		if (Array.isArray(value)) {
			return value.slice(0, 20).map(function (item) {
				return compactValue(item, depth - 1);
			});
		}
		if (typeof value === 'object') {
			const output = {};
			Object.keys(value).slice(0, 40).forEach(function (key) {
				output[key] = compactValue(value[key], depth - 1);
			});
			return output;
		}
		return safeString(value);
	}

	function collectMetadata() {
		const nav = window.navigator || {};
		const screenInfo = window.screen || {};
		const currentScript = document.currentScript || null;
		return {
			reporterVersion: REPORTER_VERSION,
			scriptSrc: currentScript ? String(currentScript.src || '') : '',
			userAgent: nav.userAgent || '',
			platform: nav.platform || '',
			language: nav.language || '',
			hardwareConcurrency: nav.hardwareConcurrency || null,
			deviceMemory: nav.deviceMemory || null,
			maxTouchPoints: nav.maxTouchPoints || 0,
			url: String(window.location.href || ''),
			referrer: document.referrer || '',
			visibilityState: document.visibilityState || '',
			hidden: !!document.hidden,
			wasDiscarded: !!document.wasDiscarded,
			historyLength: window.history ? window.history.length : null,
			viewport: {
				width: window.innerWidth || 0,
				height: window.innerHeight || 0,
				devicePixelRatio: window.devicePixelRatio || 1,
			},
			screen: {
				width: screenInfo.width || 0,
				height: screenInfo.height || 0,
				orientation: screenInfo.orientation ? screenInfo.orientation.type : '',
			},
			timezoneOffsetMinutes: new Date().getTimezoneOffset(),
		};
	}

	function collectRuntimeState() {
		const nav = window.navigator || {};
		const screenInfo = window.screen || {};
		const perf = window.performance || {};
		const memory = perf.memory || null;
		const navigationEntries = typeof perf.getEntriesByType === 'function' ? perf.getEntriesByType('navigation') : [];
		const navigation = navigationEntries && navigationEntries.length > 0 ? navigationEntries[0] : null;
		const canvas = document.getElementById('canvas') || document.querySelector('canvas');
		const canvasRect = canvas && typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
		return {
			reporterVersion: REPORTER_VERSION,
			eventCount: session && Array.isArray(session.events) ? session.events.length : 0,
			lastKnownGameState: session ? session.lastKnownGameState : '',
			heartbeatAt: nowIso(),
			uptimeMs: perf && typeof perf.now === 'function' ? Math.round(perf.now()) : null,
			visibilityState: document.visibilityState || '',
			hidden: !!document.hidden,
			hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
			online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
			wasDiscarded: !!document.wasDiscarded,
			viewport: {
				width: window.innerWidth || 0,
				height: window.innerHeight || 0,
				devicePixelRatio: window.devicePixelRatio || 1,
			},
			screen: {
				width: screenInfo.width || 0,
				height: screenInfo.height || 0,
				orientation: screenInfo.orientation ? screenInfo.orientation.type : '',
			},
			canvas: canvas ? {
				width: canvas.width || 0,
				height: canvas.height || 0,
				clientWidth: canvas.clientWidth || 0,
				clientHeight: canvas.clientHeight || 0,
				rectWidth: canvasRect ? Math.round(canvasRect.width) : 0,
				rectHeight: canvasRect ? Math.round(canvasRect.height) : 0,
			} : null,
			memory: memory ? {
				jsHeapSizeLimit: memory.jsHeapSizeLimit || 0,
				totalJSHeapSize: memory.totalJSHeapSize || 0,
				usedJSHeapSize: memory.usedJSHeapSize || 0,
			} : null,
			navigation: navigation ? {
				type: navigation.type || '',
				redirectCount: navigation.redirectCount || 0,
				transferSize: navigation.transferSize || 0,
				encodedBodySize: navigation.encodedBodySize || 0,
				decodedBodySize: navigation.decodedBodySize || 0,
			} : null,
		};
	}

	function createSession() {
		const id = 'sam-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
		return {
			id: id,
			startedAt: nowIso(),
			lastHeartbeatAt: nowIso(),
			lastKnownGameState: 'booting',
			active: true,
			cleanExit: false,
			cleanExitReason: '',
			metadata: collectMetadata(),
			events: [],
		};
	}

	function normalizeStateName(value) {
		return String(value || '').toLowerCase();
	}

	function shouldFlagPreviousSession(previous) {
		if (!previous || !Array.isArray(previous.events)) {
			return false;
		}
		const state = normalizeStateName(previous.lastKnownGameState);
		const endedDuringPlay = state === 'gameplay' || state === 'paused';
		const intentionalReason = String(previous.cleanExitReason || '');
		const intentional = intentionalReason === 'quit_button' || intentionalReason === 'main_menu' || intentionalReason === 'player_dead';
		return endedDuringPlay && !intentional;
	}

	function buildReport(session, reason) {
		const lines = [];
		const events = Array.isArray(session.events) ? session.events : [];
		lines.push('Super Ape Mayhem Crash Report');
		lines.push('Generated At: ' + nowIso());
		lines.push('Reason: ' + reason);
		lines.push('Session ID: ' + String(session.id || 'unknown'));
		lines.push('Started At: ' + String(session.startedAt || 'unknown'));
		lines.push('Last Heartbeat At: ' + String(session.lastHeartbeatAt || 'unknown'));
		lines.push('Last Known Game State: ' + String(session.lastKnownGameState || 'unknown'));
		lines.push('Clean Exit: ' + String(!!session.cleanExit));
		lines.push('Clean Exit Reason: ' + String(session.cleanExitReason || ''));
		lines.push('Event Count: ' + String(events.length));
		lines.push('');
		lines.push('Metadata');
		lines.push(JSON.stringify(session.metadata || {}, null, 2));
		lines.push('');
		lines.push('Recent Events');
		events.forEach(function (event, index) {
			lines.push(String(index + 1).padStart(3, '0') + ' ' + JSON.stringify(event));
		});
		let report = lines.join('\n');
		if (report.length > MAX_REPORT_CHARS) {
			report = report.slice(0, MAX_REPORT_CHARS) + '\n[Report truncated at ' + MAX_REPORT_CHARS + ' characters]';
		}
		return report;
	}

	function saveReport(session, reason) {
		const report = {
			generatedAt: nowIso(),
			reason: reason,
			sessionId: session.id || '',
			text: buildReport(session, reason),
		};
		writeJson(REPORT_KEY, report);
		return report;
	}

	const previousSession = readJson(SESSION_KEY);
	if (shouldFlagPreviousSession(previousSession)) {
		saveReport(previousSession, 'Previous session ended while gameplay was active or paused.');
		writeJson(PENDING_KEY, {
			pending: true,
			sessionId: previousSession.id || '',
			detectedAt: nowIso(),
		});
	}

	const session = createSession();

	function trimSession() {
		while (session.events.length > MAX_EVENTS) {
			session.events.shift();
		}
		let encoded = '';
		try {
			encoded = JSON.stringify(session);
		} catch (_error) {
			return;
		}
		while (encoded.length > MAX_REPORT_CHARS && session.events.length > 40) {
			session.events.splice(0, 20);
			encoded = JSON.stringify(session);
		}
	}

	function persistNow() {
		persistTimer = 0;
		session.lastHeartbeatAt = nowIso();
		trimSession();
		writeJson(SESSION_KEY, session);
	}

	function schedulePersist() {
		if (persistTimer !== 0) {
			return;
		}
		persistTimer = window.setTimeout(persistNow, 250);
	}

	function record(type, data) {
		const event = {
			t: nowIso(),
			seq: ++eventSequence,
			type: String(type || 'event'),
			data: compactValue(data || {}, 5),
		};
		session.events.push(event);
		if (event.type === 'game.state_changed') {
			session.lastKnownGameState = String(event.data.next_state || event.data.nextState || session.lastKnownGameState);
		}
		if (event.type === 'game.quit_button') {
			session.cleanExit = true;
			session.cleanExitReason = 'quit_button';
		}
		if (event.type === 'game.return_to_main_menu') {
			session.cleanExit = true;
			session.cleanExitReason = 'main_menu';
		}
		if (event.type === 'game.player_dead') {
			session.cleanExit = true;
			session.cleanExitReason = 'player_dead';
		}
		schedulePersist();
	}

	function getLatestReport() {
		const pending = readJson(PENDING_KEY);
		const storedReport = readJson(REPORT_KEY);
		if (storedReport && storedReport.text && (pending || storedReport.reason)) {
			return String(storedReport.text);
		}
		return buildReport(session, 'Current diagnostic snapshot; no previous crash report was pending.');
	}

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text).then(function () {
				return true;
			}).catch(function () {
				return fallbackCopyText(text);
			});
		}
		return Promise.resolve(fallbackCopyText(text));
	}

	function fallbackCopyText(text) {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', 'readonly');
		textarea.style.position = 'fixed';
		textarea.style.left = '-9999px';
		textarea.style.top = '0';
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		let copied = false;
		try {
			copied = document.execCommand('copy');
		} catch (_error) {
			copied = false;
		}
		document.body.removeChild(textarea);
		return copied;
	}

	function copyLatestReport() {
		const text = getLatestReport();
		copyText(text);
		return text.length;
	}

	function submitLatestReport() {
		const text = getLatestReport();
		copyText(text);
		const subject = encodeURIComponent('Super Ape Mayhem crash report');
		const body = encodeURIComponent('The crash report was copied to my clipboard. I will paste it below this line.\n\n');
		window.location.href = 'mailto:' + REPORT_EMAIL + '?subject=' + subject + '&body=' + body;
		return text.length;
	}

	function hasPendingCrashReport() {
		const pending = readJson(PENDING_KEY);
		return !!(pending && pending.pending);
	}

	function dismissPendingCrashReport() {
		removeKey(PENDING_KEY);
		record('report.pending_dismissed', {});
		return true;
	}

	function markPageExit(reason, event) {
		record('browser.page_exit', {
			reason: reason,
			persisted: event && typeof event.persisted === 'boolean' ? event.persisted : null,
			runtime: collectRuntimeState(),
		});
		session.active = false;
		session.endedAt = nowIso();
		session.endReason = reason;
		persistNow();
	}

	function recordBrowserHeartbeat() {
		record('browser.heartbeat', collectRuntimeState());
	}

	function installConsoleHooks() {
		['warn', 'error'].forEach(function (level) {
			const original = console[level];
			if (typeof original !== 'function') {
				return;
			}
			console[level] = function () {
				const args = Array.prototype.slice.call(arguments);
				record('console.' + level, {
					message: args.map(safeString).join(' '),
				});
				return original.apply(console, args);
			};
		});
	}

	function attachCanvasListeners() {
		if (canvasAttached) {
			return;
		}
		const canvas = document.getElementById('canvas') || document.querySelector('canvas');
		if (!canvas) {
			return;
		}
		canvasAttached = true;
		canvas.addEventListener('webglcontextlost', function (event) {
			record('browser.webgl_context_lost', {
				statusMessage: event.statusMessage || '',
			});
		});
		canvas.addEventListener('webglcontextrestored', function () {
			record('browser.webgl_context_restored', {});
		});
		record('browser.canvas_attached', {
			width: canvas.width || 0,
			height: canvas.height || 0,
			clientWidth: canvas.clientWidth || 0,
			clientHeight: canvas.clientHeight || 0,
			runtime: collectRuntimeState(),
		});
	}

	window.SuperApeCrashReporter = {
		record: record,
		getLatestReport: getLatestReport,
		copyLatestReport: copyLatestReport,
		submitLatestReport: submitLatestReport,
		hasPendingCrashReport: hasPendingCrashReport,
		dismissPendingCrashReport: dismissPendingCrashReport,
	};

	installConsoleHooks();
	record('browser.session_start', session.metadata);
	record('browser.runtime_start', collectRuntimeState());
	window.setInterval(persistNow, HEARTBEAT_INTERVAL_MS);
	window.setInterval(recordBrowserHeartbeat, HEARTBEAT_INTERVAL_MS);
	window.setInterval(attachCanvasListeners, 1000);
	document.addEventListener('DOMContentLoaded', attachCanvasListeners);
	window.addEventListener('error', function (event) {
		record('browser.error', {
			message: event.message || '',
			filename: event.filename || '',
			lineno: event.lineno || 0,
			colno: event.colno || 0,
			error: event.error || null,
		});
	});
	window.addEventListener('unhandledrejection', function (event) {
		record('browser.unhandled_rejection', {
			reason: event.reason || '',
		});
	});
	document.addEventListener('visibilitychange', function () {
		record('browser.visibility_change', {
			visibilityState: document.visibilityState,
			hidden: document.hidden,
			runtime: collectRuntimeState(),
		});
	});
	window.addEventListener('pageshow', function (event) {
		record('browser.pageshow', {
			persisted: !!event.persisted,
			runtime: collectRuntimeState(),
		});
	});
	window.addEventListener('pagehide', function (event) {
		markPageExit('pagehide', event);
	});
	window.addEventListener('beforeunload', function (event) {
		markPageExit('beforeunload', event);
	});
	window.addEventListener('focus', function () {
		record('browser.focus', collectRuntimeState());
	});
	window.addEventListener('blur', function () {
		record('browser.blur', collectRuntimeState());
	});
	window.addEventListener('resize', function () {
		record('browser.resize', collectRuntimeState());
	});
	window.addEventListener('orientationchange', function () {
		record('browser.orientation_change', collectRuntimeState());
	});
	window.addEventListener('online', function () {
		record('browser.online', collectRuntimeState());
	});
	window.addEventListener('offline', function () {
		record('browser.offline', collectRuntimeState());
	});
	document.addEventListener('freeze', function () {
		record('browser.freeze', collectRuntimeState());
	});
	document.addEventListener('resume', function () {
		record('browser.resume', collectRuntimeState());
	});
}());
