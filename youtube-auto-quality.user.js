// ==UserScript==
// @name         YouTube Auto Quality (1440p/1080p)
// @namespace    https://greasyfork.org/
// @version      2.0
// @description  Automatically sets YouTube playback quality to 1440p, falling back to 1080p
// @author       You
// @match        *://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Prevent double injection
    if (window.__ytAutoQualityLoaded) return;
    window.__ytAutoQualityLoaded = true;

    // --- Configuration ---
    const DEBUG = false;
    const PREFERRED_QUALITIES = ['hd1440', 'hd1080'];
    const QUALITY_ORDER = [
        'hd2160', 'hd1440', 'hd1080', 'hd720',
        'large', 'medium', 'small', 'tiny', 'auto'
    ];
    const MAX_RETRIES = 30;

    // --- State ---
    let qualitySetForVideo = '';
    let retryCount = 0;
    let pendingTimeout = null;
    let retryTimeout = null;

    // --- Logging ---
    function log(...args) {
        if (DEBUG) console.log('[YT-AutoQuality]', ...args);
    }
    function logAlways(...args) {
        console.log('[YT-AutoQuality]', ...args);
    }

    // --- Helpers ---
    function getPlayer() {
        const moviePlayer = document.getElementById('movie_player');
        if (moviePlayer && typeof moviePlayer.getAvailableQualityLevels === 'function') {
            return moviePlayer;
        }
        return null;
    }

    function getCurrentVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v') || null;
    }

    function isWatchPage() {
        return window.location.pathname === '/watch';
    }

    // --- Quality Setting ---
    function applyQuality(player, target) {
        if (typeof player.setPlaybackQualityRange === 'function') {
            try {
                player.setPlaybackQualityRange(target, target);
            } catch (e) {
                try {
                    player.setPlaybackQualityRange(target);
                } catch (e2) { /* ignore */ }
            }
        }
        if (typeof player.setPlaybackQuality === 'function') {
            player.setPlaybackQuality(target);
        }
    }

    function verifyQuality(player, target, attempts) {
        if (attempts === undefined) attempts = 0;
        if (attempts >= 5) {
            log('⚠ Could not confirm quality change after 5 verification attempts');
            return;
        }
        setTimeout(function () {
            var p = getPlayer();
            if (!p) return;
            var current = p.getPlaybackQuality();
            if (current === target) {
                logAlways('✓ Quality confirmed:', current);
            } else {
                log('Quality is', current, ', re-applying', target, '(' + (attempts + 1) + '/5)');
                applyQuality(p, target);
                verifyQuality(p, target, attempts + 1);
            }
        }, 1500);
    }

    function setQuality() {
        if (!isWatchPage()) {
            log('Not on watch page, skipping');
            return;
        }

        const player = getPlayer();
        if (!player) {
            retry('Player not found');
            return;
        }

        const available = player.getAvailableQualityLevels();
        if (!available || available.length === 0) {
            retry('No qualities available yet');
            return;
        }

        // Find the best preferred quality that is available
        let target = null;
        for (const q of PREFERRED_QUALITIES) {
            if (available.includes(q)) {
                target = q;
                break;
            }
        }

        if (!target) {
            // Fallback: highest by known order
            target = QUALITY_ORDER.find(q => available.includes(q)) || available[0];
            log('Neither 1440p nor 1080p available. Available:', available.join(', '));
            log('Falling back to highest available:', target);
        }

        const currentQuality = player.getPlaybackQuality();
        if (currentQuality === target) {
            log('Already at', target);
            qualitySetForVideo = getCurrentVideoId();
            retryCount = 0;
            return;
        }

        logAlways('Setting quality to', target, '(current:', currentQuality + ', available:', available.join(', ') + ')');

        applyQuality(player, target);

        qualitySetForVideo = getCurrentVideoId();
        retryCount = 0;

        // Verify the change stuck
        verifyQuality(player, target);
    }

    function retry(reason) {
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
            log(reason + '. Retry ' + retryCount + '/' + MAX_RETRIES + '...');
            clearTimeout(retryTimeout);
            retryTimeout = setTimeout(setQuality, 1000);
        } else {
            log('Max retries reached, giving up for this video.');
        }
    }

    function checkAndSet() {
        // Skip Shorts and non-watch pages
        if (!isWatchPage()) return;
        if (window.location.pathname.startsWith('/shorts')) return;

        const currentId = getCurrentVideoId();
        if (currentId && currentId !== qualitySetForVideo) {
            retryCount = 0;
            clearTimeout(pendingTimeout);
            clearTimeout(retryTimeout);
            pendingTimeout = setTimeout(setQuality, 2000);
        }
    }

    // --- Player Listener ---
    function attachPlayerListener() {
        const player = getPlayer();
        if (player && typeof player.addEventListener === 'function') {
            const callbackName = '__ytAutoQualityStateChange';
            window[callbackName] = function (state) {
                // 1 = playing, 3 = buffering
                if ((state === 1 || state === 3) && isWatchPage()) {
                    checkAndSet();
                }
            };
            try {
                player.addEventListener('onStateChange', window[callbackName]);
            } catch (e) {
                try {
                    player.addEventListener('onStateChange', callbackName);
                } catch (e2) { /* ignore */ }
            }
            log('Player event listener attached');
            return true;
        }
        return false;
    }

    // --- Event Listeners ---

    // SPA navigation
    window.addEventListener('yt-navigate-finish', function () {
        log('Navigation detected');
        setTimeout(attachPlayerListener, 2000);
        checkAndSet();
    });

    // MutationObserver — only to detect initial player load, then disconnect
    const observer = new MutationObserver(function () {
        if (getPlayer()) {
            observer.disconnect();
            log('Player found via MutationObserver');
            checkAndSet();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // --- Initialization ---

    // Try attaching player listener with retries
    let attachAttempts = 0;
    const attachInterval = setInterval(function () {
        if (attachPlayerListener() || attachAttempts++ > 30) {
            clearInterval(attachInterval);
        }
    }, 2000);

    // Initial check — wait for player to exist
    function initialCheck() {
        if (getPlayer() && getCurrentVideoId()) {
            checkAndSet();
        } else if (isWatchPage()) {
            setTimeout(initialCheck, 1000);
        }
    }
    setTimeout(initialCheck, 1000);

    logAlways('Script loaded v2.0 — targeting 1440p → 1080p');
})();