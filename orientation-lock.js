(function () {
	'use strict';

	const mobileQuery = window.matchMedia('(pointer: coarse)');
	const landscapeQuery = window.matchMedia('(orientation: landscape)');
	const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);
	let overlay = null;
	let lockRequested = false;

	function isMobileLike() {
		return mobileQuery.matches || isMobileUserAgent;
	}

	function createOverlay() {
		if (overlay != null) {
			return overlay;
		}

		overlay = document.createElement('div');
		overlay.id = 'landscape-lock';
		overlay.setAttribute('aria-live', 'polite');
		overlay.innerHTML = [
			'<div class="landscape-lock__phone">',
			'<div class="landscape-lock__screen"></div>',
			'</div>',
			'<div class="landscape-lock__arrow"></div>',
			'<div class="landscape-lock__label">TURN SIDEWAYS</div>',
		].join('');
		document.body.appendChild(overlay);
		return overlay;
	}

	function updateOverlay() {
		if (!isMobileLike()) {
			if (overlay != null) {
				overlay.style.display = 'none';
			}
			return;
		}

		const currentOverlay = createOverlay();
		currentOverlay.style.display = landscapeQuery.matches ? 'none' : 'flex';
	}

	function tryLockLandscape() {
		if (lockRequested || !isMobileLike()) {
			return;
		}

		lockRequested = true;
		const orientation = screen.orientation;
		if (orientation == null || typeof orientation.lock !== 'function') {
			return;
		}

		const lock = function () {
			orientation.lock('landscape').catch(function () {});
		};

		if (document.fullscreenElement != null) {
			lock();
			return;
		}

		if (document.documentElement.requestFullscreen != null) {
			document.documentElement.requestFullscreen().then(lock).catch(lock);
		} else {
			lock();
		}
	}

	function injectStyles() {
		const style = document.createElement('style');
		style.textContent = [
			'#landscape-lock{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;flex-direction:column;gap:18px;background:#100d0b;color:#fff8db;font-family:Arial Black,Impact,sans-serif;letter-spacing:0;text-align:center}',
			'.landscape-lock__phone{width:86px;height:140px;border:9px solid #fff8db;border-radius:24px;position:relative;transform:rotate(90deg);box-shadow:0 0 38px rgba(255,170,67,.5)}',
			'.landscape-lock__screen{position:absolute;inset:14px;border-radius:12px;background:linear-gradient(135deg,#ffcc58,#a33b24 56%,#17110f)}',
			'.landscape-lock__arrow{width:72px;height:72px;border:10px solid #ffe59a;border-left-color:transparent;border-bottom-color:transparent;border-radius:50%;transform:rotate(45deg)}',
			'.landscape-lock__label{font-size:28px;line-height:1;text-shadow:0 4px 0 #25160f}',
			'@media (orientation:landscape){#landscape-lock{display:none!important}}',
		].join('');
		document.head.appendChild(style);
	}

	document.addEventListener('DOMContentLoaded', function () {
		injectStyles();
		updateOverlay();
	});

	window.addEventListener('resize', updateOverlay);
	window.addEventListener('orientationchange', updateOverlay);
	document.addEventListener('pointerdown', tryLockLandscape, { once: true });
}());
