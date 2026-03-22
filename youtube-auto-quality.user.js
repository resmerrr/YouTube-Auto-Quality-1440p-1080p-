// ==UserScript==
// @name         YouTube Auto Quality (1440p/1080p/720p)
// @namespace    https://greasyfork.org/
// @version      2.1
// @description  Automatically sets YouTube playback quality to 1440p/1080p/720p
// @author       You
// @match        *://*.youtube.com/*
// @exclude      *://accounts.youtube.com/*
// @exclude      *://www.youtube.com/live_chat_replay*
// @exclude      *://www.youtube.com/persist_identity*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (window.__ytAutoQualityLoaded) return;
    window.__ytAutoQualityLoaded = true;

    // ======================== CONFIG ========================
    const PREFERRED = [1440, 1080, 720];
    const DEBUG = true;
    const QUALITY_KEYWORDS = [
        'Quality', 'Kualitas', 'Qualität', 'Qualité', 'Calidad',
        'Qualità', '画質', '화질', 'คุณภาพ', 'Vídeo', 'Resolusi',
        'Resolution', 'Качество', 'Kwaliteit', '品質'
    ];

    // ======================== STATE =========================
    let qualitySetForVideo = '';
    let settingInProgress = false;
    let debounceTimer = null;
    let lastUrl = location.href;
    let activeObserver = null;

    // ======================== HELPERS =======================
    function log(...args) {
        if (DEBUG) console.log('[YT-AutoQuality]', ...args);
    }

    function getVideoId() {
        return new URLSearchParams(window.location.search).get('v');
    }

    function isWatchPage() {
        return window.location.pathname === '/watch';
    }

    function isAdPlaying() {
        var p = document.getElementById('movie_player');
        return p && (
            p.classList.contains('ad-showing') ||
            !!p.querySelector('.ytp-ad-text')
        );
    }

    /**
     * Poll for a DOM element to appear, then run callback.
     * Borrowed from the GitHub script's pattern.
     */
    function waitForElement(selector, callback, maxAttempts, interval) {
        maxAttempts = maxAttempts || 80;
        interval = interval || 150;
        var attempts = 0;

        function check() {
            var el = document.querySelector(selector);
            if (el) {
                callback(el);
            } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(check, interval);
            } else {
                log('waitForElement timeout:', selector);
            }
        }
        setTimeout(check, interval);
    }

    // ======================== QUALITY SELECTION ==============

    function selectQuality() {
        var vid = getVideoId();
        if (!vid || !isWatchPage() || vid === qualitySetForVideo) return;
        if (settingInProgress) return;

        if (isAdPlaying()) {
            log('Ad playing, retry in 5s');
            setTimeout(selectQuality, 5000);
            return;
        }

        settingInProgress = true;
        log('--- Setting quality for:', vid, '---');

        // Safety: auto-reset if something gets stuck
        var safetyTimer = setTimeout(function () {
            log('Safety reset (timeout)');
            cleanupAndReset();
        }, 20000);

        // Hide the settings menu so user doesn't see it flash
        var hideStyle = document.createElement('style');
        hideStyle.id = 'ytaq-hide';
        hideStyle.textContent =
            '.ytp-settings-menu { opacity: 0 !important; pointer-events: none !important; }';
        document.head.appendChild(hideStyle);

        // Step 1: Find and click settings button
        waitForElement('.ytp-settings-button', function (settingsBtn) {

            // Close menu if already open
            if (settingsBtn.getAttribute('aria-expanded') === 'true') {
                settingsBtn.click();
            }

            setTimeout(function () {
                // Open settings
                settingsBtn.click();

                // Step 2: Wait for menu items to appear
                waitForElement('.ytp-menuitem', function () {
                    var player = document.getElementById('movie_player');
                    if (!player) { cleanupAndReset(); return; }

                    var menuItems = player.querySelectorAll('.ytp-menuitem');
                    var qualityItem = findQualityMenuItem(menuItems);

                    if (!qualityItem) {
                        log('Quality menu item not found');
                        cleanupAndReset(settingsBtn);
                        return;
                    }

                    // Check if already at preferred quality
                    var contentEl = qualityItem.querySelector('.ytp-menuitem-content');
                    var contentText = contentEl ? contentEl.textContent : '';

                    for (var i = 0; i < PREFERRED.length; i++) {
                        if (contentText.indexOf(PREFERRED[i] + 'p') !== -1 &&
                            !/auto/i.test(contentText)) {
                            log('Already at', PREFERRED[i] + 'p');
                            qualitySetForVideo = vid;
                            cleanupAndReset();
                            return;
                        }
                    }

                    // Step 3: Click quality menu item
                    log('Opening quality submenu...');
                    qualityItem.click();

                    // Step 4: Wait for submenu, then pick quality
                    setTimeout(function () {
                        handleQualitySubmenu(vid, settingsBtn);
                    }, 600);

                }, 60, 150);
            }, 400);
        }, 30, 500);

        // --- Inner functions ---

        function handleQualitySubmenu(videoId, settingsBtn) {
            var player = document.getElementById('movie_player');
            if (!player) { cleanupAndReset(); return; }

            var options = Array.from(player.querySelectorAll('.ytp-menuitem'));

            // Check if these are resolution options or simplified panel
            var hasResolutions = options.some(function (opt) {
                var label = opt.querySelector('.ytp-menuitem-label');
                return label && /^\s*\d{3,4}p/.test(label.textContent);
            });

            if (!hasResolutions) {
                // Simplified panel — look for "Advanced" button
                log('Simplified quality panel detected');
                for (var i = 0; i < options.length; i++) {
                    var label = options[i].querySelector('.ytp-menuitem-label');
                    if (!label) continue;
                    if (/advanced|avancé|erweitert|avanzad|詳細|geavanceerd|고급|расширенн/i
                        .test(label.textContent)) {
                        log('Clicking "Advanced"...');
                        options[i].click();
                        setTimeout(function () {
                            pickResolution(videoId, settingsBtn);
                        }, 600);
                        return;
                    }
                }
                log('"Advanced" button not found');
            }

            pickResolution(videoId, settingsBtn);
        }

        function pickResolution(videoId, settingsBtn) {
            var player = document.getElementById('movie_player');
            if (!player) { cleanupAndReset(); return; }

            var options = Array.from(player.querySelectorAll('.ytp-menuitem'));
            var target = null;
            var targetText = '';

            // Try each preferred quality in order
            for (var q = 0; q < PREFERRED.length; q++) {
                for (var o = 0; o < options.length; o++) {
                    var label = options[o].querySelector('.ytp-menuitem-label');
                    if (!label) continue;
                    var text = label.textContent.trim();

                    // Skip premium options
                    if (/premium/i.test(text) ||
                        /premium/i.test(options[o].innerHTML)) continue;

                    if (new RegExp('^\\s*' + PREFERRED[q] + 'p', 'i').test(text)) {
                        target = options[o];
                        targetText = text;
                        break;
                    }
                }
                if (target) break;
            }

            if (target) {
                log('✓ Selecting:', targetText);
                // Allow pointer events for the click
                hideStyle.textContent =
                    '.ytp-settings-menu { opacity: 0 !important; }';
                target.click();
                qualitySetForVideo = videoId;
            } else {
                // Fallback: pick highest available non-premium
                log('Preferred quality not available. Options:');
                var best = null;
                var bestVal = 0;
                for (var i = 0; i < options.length; i++) {
                    var lbl = options[i].querySelector('.ytp-menuitem-label');
                    if (!lbl) continue;
                    var t = lbl.textContent;
                    log('  -', t.trim());
                    if (/premium/i.test(t)) continue;
                    var match = t.match(/(\d{3,4})p/);
                    if (match) {
                        var val = parseInt(match[1], 10);
                        if (val > bestVal) {
                            bestVal = val;
                            best = options[i];
                        }
                    }
                }
                if (best) {
                    log('✓ Fallback:', bestVal + 'p');
                    best.click();
                    qualitySetForVideo = videoId;
                } else {
                    log('✗ No suitable quality found');
                }
            }

            cleanupAndReset();
        }

        function cleanupAndReset(btnToClose) {
            clearTimeout(safetyTimer);
            setTimeout(function () {
                var s = document.getElementById('ytaq-hide');
                if (s) s.remove();
                settingInProgress = false;
                // Close menu if still open
                if (btnToClose &&
                    btnToClose.getAttribute('aria-expanded') === 'true') {
                    btnToClose.click();
                }
            }, 300);
        }
    }

    // ======================== FIND QUALITY MENU ITEM =========

    function findQualityMenuItem(menuItems) {
        var i, item, content, label;

        // Method 1: resolution pattern in content area (language-independent)
        for (i = 0; i < menuItems.length; i++) {
            content = menuItems[i].querySelector('.ytp-menuitem-content');
            if (content && /\d{3,4}p/.test(content.textContent)) {
                return menuItems[i];
            }
        }

        // Method 2: quality keywords in label
        for (i = 0; i < menuItems.length; i++) {
            label = menuItems[i].querySelector('.ytp-menuitem-label');
            if (!label) continue;
            var text = label.textContent.toLowerCase();
            for (var k = 0; k < QUALITY_KEYWORDS.length; k++) {
                if (text.indexOf(QUALITY_KEYWORDS[k].toLowerCase()) !== -1) {
                    return menuItems[i];
                }
            }
        }

        // Method 3: aria-label containing "quality"
        for (i = 0; i < menuItems.length; i++) {
            var aria = menuItems[i].getAttribute('aria-label') || '';
            if (/quality/i.test(aria)) {
                return menuItems[i];
            }
        }

        return null;
    }

    // ======================== PLAYER READY DETECTION =========
    // Borrowed from GitHub script: MutationObserver watches for
    // settings button to appear, meaning player is ready

    function waitForPlayerAndSelect() {
        // Cancel previous observer
        if (activeObserver) {
            activeObserver.disconnect();
            activeObserver = null;
        }

        var observer = new MutationObserver(function () {
            // Check settings button exists
            if (!document.querySelector('.ytp-settings-button')) return;

            // Check video element has data
            var player = document.getElementById('movie_player');
            if (!player) return;
            var video = player.querySelector('video');
            if (!video || video.readyState < 1) return;

            // Player is ready
            observer.disconnect();
            activeObserver = null;
            log('Player ready, starting quality selection...');
            setTimeout(selectQuality, 800);
        });

        activeObserver = observer;
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        // Safety: try anyway after 15 seconds
        setTimeout(function () {
            if (activeObserver) {
                observer.disconnect();
                activeObserver = null;
            }
            var vid = getVideoId();
            if (vid && vid !== qualitySetForVideo && isWatchPage()) {
                log('Safety timeout — trying anyway');
                selectQuality();
            }
        }, 15000);
    }

    // ======================== NAVIGATION DETECTION ===========
    // Debounced handler prevents multiple simultaneous attempts

    function onNavigation(source) {
        if (!isWatchPage()) return;
        var vid = getVideoId();
        if (!vid || vid === qualitySetForVideo) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            log('Navigation via:', source, '| video:', vid);
            settingInProgress = false; // Reset stuck state
            waitForPlayerAndSelect();
        }, 300);
    }

    // --- YouTube SPA events (on DOCUMENT, not window — this was the bug) ---
    document.addEventListener('yt-navigate-finish', function () {
        onNavigation('yt-navigate-finish');
    });
    document.addEventListener('yt-page-data-updated', function () {
        onNavigation('yt-page-data-updated');
    });

    // --- Also listen on window as backup ---
    window.addEventListener('yt-navigate-finish', function () {
        onNavigation('yt-navigate-finish-win');
    });

    // --- History API interception ---
    (function () {
        var origPush = history.pushState;
        var origReplace = history.replaceState;

        history.pushState = function () {
            origPush.apply(this, arguments);
            setTimeout(function () {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    onNavigation('pushState');
                }
            }, 200);
        };

        history.replaceState = function () {
            origReplace.apply(this, arguments);
            setTimeout(function () {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    onNavigation('replaceState');
                }
            }, 200);
        };
    })();

    // --- Browser back/forward ---
    window.addEventListener('popstate', function () {
        onNavigation('popstate');
    });

    // --- URL polling safety net ---
    setInterval(function () {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            onNavigation('url-poll');
        }
    }, 2000);

    // ======================== INITIAL LOAD ===================

    // On window load (like the GitHub script does)
    window.addEventListener('load', function () {
        log('Window loaded');
        lastUrl = location.href;
        if (isWatchPage() && getVideoId()) {
            waitForPlayerAndSelect();
        }
    });

    // If page already loaded when script runs
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(function () {
            if (isWatchPage() && getVideoId() && !qualitySetForVideo) {
                log('Page already loaded, starting...');
                waitForPlayerAndSelect();
            }
        }, 1500);
    }

    log('Script loaded v4.0');
})();
