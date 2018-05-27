// ==========================================================================
// Advertisement plugin using Google IMA HTML5 SDK
// Create an account with our ad partner, vi here:
// https://www.vi.ai/publisher-video-monetization/
// ==========================================================================

/* global google */

import utils from '../utils';

class Ads {
    /**
     * Ads constructor.
     * @param {object} player
     * @return {Ads}
     */
    constructor(player) {
        this.player = player;
        this.tag = player.config.ads.tag;
        this.enabled = player.isHTML5 && player.isVideo && utils.is.string(this.tag) && this.tag.length;

        this.prerollEnabled = player.config.ads.prerollEnabled;
        this.midrollEnabled = player.config.ads.midrollEnabled;
        this.videoInterval = player.config.ads.videoInterval;
        this.overlayInterval = player.config.ads.overlayInterval;

        this.loader = null;
        this.manager = null;
        this.cuePoints = [];
        this.elements = {
            container: null,
            displayContainer: null,
        };
        this.events = {};
        this.safetyTimer = null;
        this.requestAttempts = 0;
        this.adCount = 1;
        this.adPosition = 1;
        this.previousMidrollTime = 0;
        this.requestRunning = false;
        this.tag = 'https://pubads.g.doubleclick.net/gampad/ads' +
            '?sz=640x480&iu=/124319096/external/single_ad_samples' +
            '&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast' +
            '&unviewed_position_start=1&cust_params=deployment%3Ddevsite' +
            '%26sample_ct%3Dlinear&correlator=';

        // Setup a promise to resolve when the IMA manager is ready
        this.loaderPromise = new Promise((resolve, reject) => {
            this.player.on('adsloaderready', resolve);
            this.on('error', () => reject(new Error('Initial loaderPromise failed to load.')));
        });

        this.load();
    }

    /**
     * Load the IMA SDK
     */
    load() {
        if (this.enabled) {
            // Check if the Google IMA3 SDK is loaded or load it ourselves
            if (!utils.is.object(window.google) || !utils.is.object(window.google.ima)) {
                utils
                    .loadScript(this.player.config.urls.googleIMA.api)
                    .then(() => {
                        this.ready();
                        this.setupIMA();
                    })
                    .catch(() => {
                        // Script failed to load or is blocked
                        this.trigger('error', new Error('Google IMA SDK failed to load'));
                    });
            } else {
                this.ready();
            }
        }
    }

    /**
     * Get the ads instance ready
     */
    ready() {
        // Start ticking our safety timer. If the whole advertisement
        // thing doesn't resolve within our set time; we bail
        this.startSafetyTimer(12000, 'ready()');

        // Clear the safety timer
        this.loaderPromise.then(() => {
            this.clearSafetyTimer('onAdsManagerLoaded()');
        });

        // Subscribe to the LOADED event as we will want to clear our initial
        // safety timer, but also start a new one, as sometimes advertisements
        // can have trouble starting.
        this.player.on('adsmanagerloaded', () => {
            // Start our safety timer every time an ad is loaded.
            // It can happen that an ad loads and starts, but has an error
            // within itself, so we never get an error event from IMA.
            this.clearSafetyTimer('adloaded');
            this.startSafetyTimer(8000, 'adloaded');
        });

        // Subscribe to the STARTED event, so we can clear the safety timer
        // started from the LOADED event. This is to avoid any problems within
        // an advertisement itself, like when it doesn't start or has
        // a javascript error, which is common with VPAID.
        this.player.on('adsstarted', () => {
            this.clearSafetyTimer('adsstarted');
        });

        // Get current track time
        let time;
        this.player.on('seeking', () => {
            time = this.player.currentTime;
            return time;
        });

        // Discard ads when skipping the track at certain cue's
        this.player.on('seeked', () => {
            if (this.manager) {
                const seekedTime = this.player.currentTime;
                if (this.cuePoints){
                    this.cuePoints.forEach((cuePoint, index) => {
                        if (time < cuePoint && cuePoint < seekedTime) {
                            this.manager.discardAdBreak();
                            this.cuePoints.splice(index, 1);
                        }
                    });
                }
            }
        });

        // Run a pre-roll advertisement on first play.
        this.player.on('play', () => {
            if (this.prerollEnabled) {
                this.prerollEnabled = false;
                this.requestAd();
                this.player.debug.log('Starting a pre-roll advertisement.');
            }
        });

        // Run a post-roll advertisement and complete the ads loader
        this.player.on('ended', () => {
            this.adPosition = 0; // Make sure we register a post-roll.
            this.requestAd();
            this.player.debug.log('Starting a post-roll advertisement.');
        });

        // Run an mid-roll video advertisement on a certain time
        // Timeupdate event updates ~250ms per second so we set a previousMidrollTime
        // to avoid consecutive requests for ads, as it is quite a race
        // Todo: request video midroll based on videomidroll timer.
        this.player.on('timeupdate', () => {
            if(this.midrollEnabled && !this.requestRunning) {
                const currentTime = Math.ceil(this.player.currentTime);
                const interval = Math.ceil(this.overlayInterval);
                const duration = Math.floor(this.player.duration);
                if (currentTime % interval === 0
                    && currentTime !== this.previousMidrollTime
                    && currentTime < duration - interval) {
                    this.previousMidrollTime = currentTime;
                    this.requestAd();
                    this.player.debug.log('Starting a mid-roll advertisement.');
                }
            }
        });
    }

    /**
     * In order for the SDK to display ads for our video, we need to tell it where to put them,
     * so here we define our ad container. This div is set up to render on top of the video player.
     * Using the code below, we tell the SDK to render ads within that div. We also provide a
     * handle to the content video player - the SDK will poll the current time of our player to
     * properly place mid-rolls. After we create the ad display container, we initialize it. On
     * mobile devices, this initialization is done as the result of a user action.
     */
    setupIMA() {
        // Create the container for our advertisements
        this.elements.container = utils.createElement('div', {
            class: this.player.config.classNames.ads,
        });
        this.player.elements.container.appendChild(this.elements.container);

        // So we can run VPAID2
        google.ima.settings.setVpaidMode(google.ima.ImaSdkSettings.VpaidMode.ENABLED);

        // Set language
        google.ima.settings.setLocale(this.player.config.ads.language);

        // We assume the adContainer is the video container of the plyr element
        // that will house the ads
        this.elements.displayContainer = new google.ima.AdDisplayContainer(this.elements.container);

        // Create ads loader
        this.loader = new google.ima.AdsLoader(this.elements.displayContainer);

        // Listen and respond to ads loaded and error events
        this.loader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, event => this.onAdsManagerLoaded(event), false);
        this.loader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, error => this.onAdError(error), false);

        // The ad loader is ready to receive an advertisement request.
        utils.dispatchEvent.call(this.player, this.player.media, 'adsloaderready');
    }

    /**
     * Request advertisements
     */
    requestAd() {
        const { container } = this.player.elements;

        if (typeof google === 'undefined') {
            this.trigger('error', 'Unable to request ad, google IMA SDK not defined.');
            return;
        }

        if (this.requestRunning) {
            this.player.debug.log('A request is already running');
            return;
        }

        this.requestRunning = true;

        try {
            // Request new video ads
            const adsRequest = new google.ima.AdsRequest();

            // Update our adTag. We add additional parameters so Tunnl
            // can use the values as new metrics within reporting.
            // It is also used to determine if we get an overlay or not.
            this.adCount += 1;
            const positionCount = this.adCount - 1;
            const requestAttempts = this.requestAttempts + 1;
            this.tag = utils.updateQueryStringParameter(this.tag, 'ad_count', this.adCount);
            this.tag = utils.updateQueryStringParameter(this.tag, 'ad_request_count', requestAttempts.toString());
            if(this.adPosition === 0) {
                this.tag = utils.updateQueryStringParameter(this.tag, 'ad_position', 'postroll');
                // If there is a re-request attempt for a preroll then make
                // sure we increment the adCount but still ask for a preroll.
                // The same goes for midrolls and postrolls.
                if (this.requestAttempts === 0) {
                    this.adPosition = 1;
                }
            } else if(this.adPosition === 1) {
                this.tag = utils.updateQueryStringParameter(this.tag, 'ad_position', 'preroll');
                if (this.requestAttempts === 0) {
                    this.adPosition = 2;
                }
            } else {
                this.tag = utils.updateQueryStringParameter(this.tag, 'ad_midroll_count', positionCount.toString());
                this.tag = utils.updateQueryStringParameter(this.tag, 'ad_type', 'image');
                this.tag = utils.updateQueryStringParameter(this.tag, 'ad_skippable', '0');
                this.tag = utils.updateQueryStringParameter(this.tag, 'ad_position', 'subbanner');
                if (this.requestAttempts === 0) {
                    this.adPosition = 3;
                }
            }

            // GDPR personalised advertisement ruling.
            const gdprTargeting = (document.location.search.indexOf('gdpr-targeting') >= 0);
            const gdprTargetingConsentDeclined = (document.location.search.indexOf('gdpr-targeting=false') >= 0);
            this.tag = (gdprTargeting) ?
                utils.updateQueryStringParameter(this.tag, 'npa', (gdprTargetingConsentDeclined) ? '1' : '0') : this.tag;

            adsRequest.adTagUrl = this.tag;

            this.player.debug.log('Tag URL:', this.tag);

            // Specify the linear and nonlinear slot sizes. This helps the SDK
            // to select the correct creative if multiple are returned
            adsRequest.linearAdSlotWidth = container.offsetWidth;
            adsRequest.linearAdSlotHeight = container.offsetHeight;
            adsRequest.nonLinearAdSlotWidth = container.offsetWidth;

            // Set a small height when we want to run a midroll on order to enforce an IAB leaderboard.
            const isMidrollDesktop = (this.adPosition === 3 && (!/Mobi/.test(navigator.userAgent)));
            adsRequest.nonLinearAdSlotHeight = (isMidrollDesktop) ? 120 : container.offsetHeight;
            console.log(`nonLinearAdSlotWidth: ${container.offsetWidth}`);
            console.log(`nonLinearAdSlotHeight: ${adsRequest.nonLinearAdSlotHeight}`);

            // We don't want non-linear FULL SLOT ads when we're running mid-rolls on desktop
            adsRequest.forceNonLinearFullSlot = (!isMidrollDesktop);
            console.log(`forceNonLinearFullSlot: ${(!isMidrollDesktop)}`);

            // Send a google event.
            try {
                /* eslint-disable */
                if (typeof window['ga'] !== 'undefined') {
                    const time = new Date();
                    const h = time.getHours();
                    const d = time.getDate();
                    const m = time.getMonth();
                    const y = time.getFullYear();
                    let categoryName = '';
                    if (this.adPosition === 1) {
                        categoryName = 'AD_POSTROLL';
                    } else if (this.adPosition === 2) {
                        categoryName = 'AD_PREROLL';
                    } else if (this.adPosition === 3) {
                        categoryName = 'AD_MIDROLL';
                    } else {
                        categoryName = 'AD_MIDROLL_FULLSLOT'
                    }
                    window['ga']('tubia.send', {
                        hitType: 'event',
                        eventCategory: categoryName,
                        eventAction: `${window.location.hostname} | h${h} d${d} m${m} y${y}`,
                        eventLabel: this.tag,
                    });
                }
                /* eslint-enable */
            } catch (error) {
                this.player.debug.log('Ads error', error);
            }

            // https://developers.google.com/interactive-media-ads/docs/sdks/html5/desktop-autoplay
            // request.setAdWillAutoPlay(false);
            // request.setAdWillPlayMuted(false);

            this.loader.requestAds(adsRequest);
        } catch (e) {
            this.onAdError(e);
        }
    }

    /**
     * This method is called whenever the ads are ready inside the AdDisplayContainer
     * @param {Event} adsManagerLoadedEvent
     */
    onAdsManagerLoaded(adsManagerLoadedEvent) {
        const { container } = this.player.elements;

        // Get the ads manager
        const settings = new google.ima.AdsRenderingSettings();
        settings.enablePreloading = true;
        settings.restoreCustomPlaybackStateOnAdBreakComplete = true;

        // The SDK is polling currentTime on the contentPlayback. And needs a duration
        // so it can determine when to start the mid- and post-roll
        this.manager = adsManagerLoadedEvent.getAdsManager(this.player, settings);

        // Get the cue points for any mid-rolls by filtering out the pre- and post-roll
        this.cuePoints = this.manager.getCuePoints();

        // Add advertisement cue's within the time line if available
        // Todo: cue points are not yet working with how we currently request ads.
        if (this.cuePoints) {
            this.cuePoints.forEach(cuePoint => {
                if (cuePoint !== 0 && cuePoint !== -1 && cuePoint < this.player.duration) {
                    const seekElement = this.player.elements.progress;

                    if (seekElement) {
                        const cuePercentage = 100 / this.player.duration * cuePoint;
                        const cue = utils.createElement('span', {
                            class: this.player.config.classNames.cues,
                        });

                        cue.style.left = `${cuePercentage.toString()}%`;
                        seekElement.appendChild(cue);
                    }
                }
            });
        }

        // Set volume to match player
        this.manager.setVolume(this.player.volume);

        // Add listeners to the required events
        // Advertisement error events
        this.manager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, error => this.onAdError(error));

        // Advertisement regular events
        Object.keys(google.ima.AdEvent.Type).forEach(type => {
            this.manager.addEventListener(google.ima.AdEvent.Type[type], event => this.onAdEvent(event));
        });

        // Listen to the resizing of the window. And resize ad accordingly
        window.addEventListener('resize', () => {
            if (this.manager) {
                this.manager.resize(container.offsetWidth, container.offsetHeight, google.ima.ViewMode.NORMAL);
            }
        });

        // Once the ad display container is ready and ads have been retrieved,
        // we can use the ads manager to display the ads.
        if (this.manager && this.elements.displayContainer) {
            // Send an event to tell that our ads manager
            // has successfully loaded the VAST response.
            utils.dispatchEvent.call(this.player, this.player.media, 'adsmanagerloaded');

            // Initialize the container. Must be done via a user action on mobile devices
            this.elements.displayContainer.initialize();

            try {
                // Initialize the ads manager. Ad rules playlist will start at this time
                this.manager.init(container.offsetWidth, container.offsetHeight, google.ima.ViewMode.NORMAL);

                // Call play to start showing the ad. Single video and overlay ads will
                // start at this time; the call will be ignored for ad rules
                this.manager.start();
            } catch (adError) {
                // An error may be thrown if there was a problem with the VAST response
                this.onAdError(adError);
            }
        }
    }

    /**
     * This is where all the event handling takes place. Retrieve the ad from the event. Some
     * events (e.g. ALL_ADS_COMPLETED) don't have the ad object associated
     * https://developers.google.com/interactive-media-ads/docs/sdks/html5/v3/apis#ima.AdEvent.Type
     * @param {Event} event
     */
    onAdEvent(event) {
        const { container } = this.player.elements;

        // Retrieve the ad from the event. Some events (e.g. ALL_ADS_COMPLETED)
        // don't have ad object associated
        const ad = event.getAd();

        // Proxy event
        const dispatchEvent = type => {
            const eventMessage = `ads${type.replace(/_/g, '').toLowerCase()}`;
            utils.dispatchEvent.call(this.player, this.player.media, eventMessage);
        };

        switch (event.type) {
            case google.ima.AdEvent.Type.LOADED:
                dispatchEvent('loaded');
                // Todo: Make sure ad container resizes based on non-linear ad and back again.
                // Todo: Make sure we call the second video midroll ad
                // Todo: Make sure we request ads regardless of failure before.
                // Todo: Add the actual GDPR :P
                if (!ad.isLinear()) {
                    const advertisement = ad[Object.keys(ad)[0]];
                    if (advertisement) {
                        this.elements.container.style.width = `${advertisement.width}px`;
                        this.elements.container.style.height = `${advertisement.height}px`;
                    }

                    // Show the container when we get a non-linear ad.
                    // Because non-linear ads won't trigger CONTENT_PAUSE_REQUESTED.
                    this.showAd();
                }
                // console.info('Ad type: ' + event.getAd().getAdPodInfo().getPodIndex());
                // console.info('Ad time: ' + event.getAd().getAdPodInfo().getTimeOffset());
                break;

            case google.ima.AdEvent.Type.STARTED:
                dispatchEvent('started');
                // Show the container when we get a non-linear ad.
                // Because non-linear ads won't trigger CONTENT_PAUSE_REQUESTED.
                if (!ad.isLinear()) {
                    this.showAd();
                }
                break;

            case google.ima.AdEvent.Type.IMPRESSION:
                dispatchEvent('impression');
                // Send a google event.
                try {
                    /* eslint-disable */
                    if (typeof window['ga'] !== 'undefined') {
                        window['ga']('tubia.send', {
                            hitType: 'event',
                            eventCategory: 'AD',
                            eventAction: 'IMPRESSION',
                            eventLabel: this.adPosition,
                        });
                    }
                    /* eslint-enable */
                } catch (error) {
                    this.player.debug.log('Ads error', error);
                }
                break;

            case google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED:
                dispatchEvent('contentpause');
                // This event indicates the ad has started - the video player can adjust the UI,
                // for example display a pause button and remaining time. Fired when content should
                // be paused. This usually happens right before an ad is about to cover the content
                this.pauseContent();
                this.showAd();
                break;

            case google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED:
                dispatchEvent('contentresume');
                // This event indicates the ad has finished - the video player can perform
                // appropriate UI actions, such as removing the timer for remaining time detection.
                // Fired when content should be resumed. This usually happens when an ad finishes
                // or collapses

                // Hide the advertisement.
                this.hideAd();

                // Destroy the manager so we can grab new ads after this.
                // If we don't then we're not allowed to call new ads based
                // on google policies, as they interpret this as an accidental
                // video requests. https://developers.google.com/interactive-
                // media-ads/docs/sdks/android/faq#8
                this.loaderPromise.then(() => {
                    if (this.loader) {
                        this.loader.contentComplete();
                    }
                    if (this.manager) {
                        this.manager.destroy();
                    }

                    // We're done with the current request.
                    this.requestRunning = false;

                    // Log message to tell that the whole advertisement
                    // thing is finished.
                    this.player.debug.log('IMA SDK is ready for new ad requests.');
                }).catch(() => {
                    this.player.debug.warn(new Error('adsLoaderPromise failed to load.'));
                });

                // Play our video
                if (this.player.currentTime < this.player.duration) {
                    this.player.play();
                }
                break;

            case google.ima.AdEvent.Type.MIDPOINT:
                dispatchEvent('midpoint');
                break;

            case google.ima.AdEvent.Type.COMPLETE:
                dispatchEvent('complete');
                // Hide the container when run a non-linear ad.
                // Because non-linear ads won't trigger CONTENT_RESUME_REQUESTED.
                if (!ad.isLinear()) {
                    this.hideAd();
                }
                break;

            case google.ima.AdEvent.Type.ALL_ADS_COMPLETED:
                dispatchEvent('allcomplete');
                // All ads for the current videos are done. We can now request new advertisements
                // in case the video is re-played
                break;

            case google.ima.AdEvent.Type.USER_CLOSE:
                dispatchEvent('complete');
                // Hide the container when run a non-linear ad.
                // Because non-linear ads won't trigger CONTENT_RESUME_REQUESTED.
                if (!ad.isLinear()) {
                    this.hideAd();
                }
                break;

            case google.ima.AdEvent.Type.CLICK:
                dispatchEvent('click');
                break;

            default:
                break;
        }
    }

    /**
     * Any ad error handling comes through here
     * @param {Event} event
     */
    onAdError(event) {
        this.cancel();
        this.player.debug.warn('Ads error', event);

        // Send a google event.
        try {
            /* eslint-disable */
            if (typeof window['ga'] !== 'undefined') {
                window['ga']('tubia.send', {
                    hitType: 'event',
                    eventCategory: 'AD',
                    eventAction: 'AD_ERROR',
                    eventLabel: event.getError(),
                });
            }
            /* eslint-enable */
        } catch (error) {
            this.player.debug.log('Ads error', error);
        }
    }

    /**
     * Show the advertisement container
     */
    showAd() {
        this.elements.container.style.zIndex = '3';
    }

    /**
     * Hide the advertisement container
     */
    hideAd() {
        this.elements.container.style.zIndex = '';
    }

    /**
     * Pause our video
     */
    pauseContent() {
        // Ad is playing.
        this.playing = true;

        // Pause our video.
        this.player.pause();
    }

    /**
     * Cancel our ads, just resume the content and trigger an error
     */
    cancel() {
        // Destroy the manager so we can grab new ads after this.
        // If we don't then we're not allowed to call new ads based
        // on google policies, as they interpret this as an accidental
        // video requests. https://developers.google.com/interactive-
        // media-ads/docs/sdks/android/faq#8
        this.loaderPromise.then(() => {
            if (this.loader) {
                this.loader.contentComplete();
            }
            if (this.manager) {
                this.manager.destroy();
            }

            // Preload new ads by doing a new request.
            // Only try once. Only for 1 specific domain; testing purposes.
            if (this.requestAttempts === 0) {
                this.player.debug.log('Trying to request an advertisement again in 3 seconds...');

                // Increment our request attempt count.
                this.requestAttempts += 1;

                // Try a new request. Good chance we might get an ad now.
                // Set a delay so our DSP can adjust its price.
                setTimeout(() => {
                    // We're done with the current request.
                    this.requestRunning = false;

                    // Make the "automatic" request.
                    this.requestAd();
                }, 3000);
            } else {
                // Hide the advertisement.
                this.hideAd();

                // We're done with the current request.
                this.requestRunning = false;
            }
        }).catch(() => {
            this.player.debug.warn(new Error('adsLoaderPromise failed to load.'));
        });

        // Log message to tell that the whole advertisement
        // thing is finished.
        this.player.debug.log('Advertisement has been canceled.');

        // Tell our instance that we're done for now
        // this.trigger('error');
    }

    /**
     * Handles callbacks after an ad event was invoked
     * @param {string} event - Event type
     */
    trigger(event, ...args) {
        const handlers = this.events[event];
        if (utils.is.array(handlers)) {
            handlers.forEach(handler => {
                if (utils.is.function(handler)) {
                    handler.apply(this, args);
                }
            });
        }
    }

    /**
     * Add event listeners
     * @param {string} event - Event type
     * @param {function} callback - Callback for when event occurs
     * @return {Ads}
     */
    on(event, callback) {
        if (!utils.is.array(this.events[event])) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
        return this;
    }

    /**
     * Setup a safety timer for when the ad network doesn't respond for whatever reason.
     * The advertisement has 12 seconds to get its things together. We stop this timer when the
     * advertisement is playing, or when a user action is required to start, then we clear the
     * timer on ad ready
     * @param {number} time
     * @param {string} from
     */
    startSafetyTimer(time, from) {
        this.player.debug.log(`Safety timer invoked from: ${from}`);
        this.safetyTimer = setTimeout(() => {
            this.player.debug.log(`Safety timer triggered from: ${from}`);
            this.cancel();
            this.clearSafetyTimer('startSafetyTimer()');
        }, time);
    }

    /**
     * Clear our safety timer(s)
     * @param {string} from
     */
    clearSafetyTimer(from) {
        if (!utils.is.nullOrUndefined(this.safetyTimer)) {
            this.player.debug.log(`Safety timer cleared from: ${from}`);
            clearTimeout(this.safetyTimer);
            this.safetyTimer = null;
        }
    }
}

export default Ads;