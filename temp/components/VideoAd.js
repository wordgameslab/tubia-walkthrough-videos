import EventBus from '../components/EventBus';
import {dankLog} from '../modules/dankLog';
import {updateQueryStringParameter} from '../modules/common';

let instance = null;

/**
 * VideoAd
 */
class VideoAd {
    /**
     * Constructor of VideoAd.
     * @param {Object} videoElement
     * @return {*}
     */
    constructor(videoElement) {
        // Make this a singleton.
        if (instance) {
            return instance;
        } else {
            instance = this;
        }

        this.debug = false;
        this.locale = 'en';
        this.prefix = 'plyr__';
        this.gameId = '4f3d7d38d24b740c95da2b03dc3a2333';
        this.adsLoader = null;
        this.adsManager = null;
        this.adContainer = null;
        this.adDisplayContainer = null;
        this.videoElement = videoElement;
        this.eventBus = new EventBus();
        this.safetyTimer = null;
        this.requestAttempts = 0;
        this.containerTransitionSpeed = 300;
        this.adCount = 0;
        this.requestAttempts = 0;
        this.width = window.innerWidth ||
            document.documentElement.clientWidth || document.body.clientWidth;
        this.height = window.innerHeight ||
            document.documentElement.clientHeight || document.body.clientHeight;
        this.tag = 'https://pubads.g.doubleclick.net/gampad/ads' +
            '?sz=640x480&iu=/124319096/external/single_ad_samples' +
            '&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast' +
            '&unviewed_position_start=1&cust_params=deployment%3Ddevsite' +
            '%26sample_ct%3Dlinear&correlator=';

        // Analytics variables
        this.eventCategory = 'AD';
    }

    /**
     * start
     * Start the VideoAd instance by first checking if we
     * have auto play capabilities. By calling start() we start the
     * creation of the adsLoader, needed to request ads. This is also
     * the time where we can change other options based on context as well.
     * @public
     */
    start() {
        // Start ticking our safety timer. If the whole advertisement
        // thing doesn't resolve within our set time, then screw this.
        this._startSafetyTimer(12000, 'start()');

        // Load Google IMA HTML5 SDK.
        this._loadIMAScript();

        // Setup a simple promise to resolve if the IMA loader is ready.
        // We mainly do this because showBanner() can be called before we've
        // even setup our ad.
        this.adsLoaderPromise = new Promise((resolve) => {
            // Wait for adsLoader to be loaded.
            this.eventBus.subscribe('AD_SDK_LOADER_READY', () => resolve());
        });

        // Setup a promise to resolve if the IMA manager is ready.
        this.adsManagerPromise = new Promise((resolve) => {
            // Wait for adsManager to be loaded.
            this.eventBus.subscribe('AD_SDK_MANAGER_READY', () => resolve());
        });

        // Subscribe to our new AD_SDK_MANAGER_READY event and clear the
        // initial safety timer set within the start of our start() method.
        this.eventBus.subscribe('AD_SDK_MANAGER_READY', () => {
            this._clearSafetyTimer('AD_SDK_MANAGER_READY');
        });

        // Show the advertisement container.
        this.eventBus.subscribe('CONTENT_PAUSE_REQUESTED', () => {
            // Show the advertisement container.
            if (this.adContainer) {
                this.adContainer.style.transform =
                    'translateX(0)';
                setTimeout(() => {
                    this.adContainer.style.opacity = '1';
                }, 10);
            }
        });
    }

    /**
     * initialUserAction
     * Start the advertisement. Ad rules dictate when to show them during video.
     * @public
     */
    initialUserAction() {
        // Play the requested advertisement whenever the adsManager is ready.
        this.adsManagerPromise.then(() => {
            // The IMA HTML5 SDK uses the AdDisplayContainer to play the
            // video ads. To initialize the AdDisplayContainer, call the
            // play() method in a user action.
            if (!this.adsManager || !this.adDisplayContainer) {
                this._onError('Missing an adsManager or adDisplayContainer');
                return;
            }
            // Always initialize the container first.
            this.adDisplayContainer.initialize();

            try {
                // Initialize the ads manager. Ad rules playlist will
                // start at this time.
                this.adsManager.init(this.width, this.height,
                    google.ima.ViewMode.NORMAL);
                // Call play to start showing the ad. Single video and
                // overlay ads will start at this time; the call will be
                // ignored for ad rules.
                this.adsManager.start();
            } catch (adError) {
                // An error may be thrown if there was a problem with the
                // VAST response.
                this._onError(adError);
            }
        });
    }

    /**
     * cancel
     * Makes it possible to stop an advertisement while its
     * loading or playing. This will clear out the adsManager, stop any
     * ad playing and allowing new ads to be called.
     * @public
     */
    cancel() {
        // Todo: cancel not working very well with ad rules.
        // Todo: https://developers.google.com/interactive-media-ads/docs/sdks/html5/ad-rules
        // Todo: Section: Disabling automatic playback of ad breaks.
        // Hide the advertisement.
        if (this.adContainer) {
            this.adContainer.style.opacity = '0';
            setTimeout(() => {
                // We do not use display none. Otherwise element.offsetWidth
                // and height will return 0px.
                this.adContainer.style.transform =
                    'translateX(-9999px)';
            }, this.containerTransitionSpeed);
        }

        // Destroy the adsManager so we can grab new ads after this.
        // If we don't then we're not allowed to call new ads based
        // on google policies, as they interpret this as an accidental
        // video requests. https://developers.google.com/interactive-
        // media-ads/docs/sdks/android/faq#8
        Promise.all([
            this.adsLoaderPromise,
            this.adsManagerPromise,
        ]).then(() => {
            if (this.adsManager) {
                this.adsManager.destroy();
            }
            if (this.adsLoader) {
                this.adsLoader.contentComplete();
            }

            this.adsLoaderPromise = new Promise((resolve) => {
                // Wait for adsLoader to be loaded.
                this.eventBus.subscribe('AD_SDK_LOADER_READY',
                    () => resolve());
            });
            this.adsManagerPromise = new Promise((resolve) => {
                // Wait for adsManager to be loaded.
                this.eventBus.subscribe('AD_SDK_MANAGER_READY',
                    () => resolve());
            });

            // Preload new ads by doing a new request.
            if (this.requestAttempts <= 3) {
                if (this.requestAttempts > 1) {
                    dankLog('AD_SDK_REQUEST_ATTEMPT', this.requestAttempts,
                        'warning');
                }
                this.requestAds();
                this.requestAttempts++;
            }
        }).catch((error) => console.log(error));

        // Send event to tell that the whole advertisement
        // thing is finished.
        let eventName = 'AD_CANCELED';
        let eventMessage = 'Advertisement has been canceled.';
        this.eventBus.broadcast(eventName, {
            name: eventName,
            message: eventMessage,
            status: 'warning',
            analytics: {
                category: this.eventCategory,
                action: eventName,
                label: this.gameId,
            },
        });
    }

    /**
     * contentEnded
     * Our video content has ended.
     * @public
     */
    contentEnded() {
        if (this.adsLoader) {
            this.adsLoader.contentComplete();
        }
    };

    /**
     * _loadIMAScript
     * Loads the Google IMA script using a <script> tag.
     * @private
     */
    _loadIMAScript() {
        // Load the HTML5 IMA SDK.
        const src = (this.debug)
            ? '//imasdk.googleapis.com/js/sdkloader/ima3_debug.js'
            : '//imasdk.googleapis.com/js/sdkloader/ima3.js';
        const script = document.getElementsByTagName('script')[0];
        const ima = document.createElement('script');
        ima.type = 'text/javascript';
        ima.async = true;
        ima.src = src;
        ima.onload = () => {
            this._createPlayer();
        };
        ima.onerror = () => {
            // Return an error event.
            this._onError(
                'IMA script failed to load! Probably due to an ADBLOCKER!');
        };

        // Append the IMA script to the first script tag within the document.
        script.parentNode.insertBefore(ima, script);
    }

    /**
     * _createPlayer
     * Creates our staging/ markup for the advertisement.
     * @private
     */
    _createPlayer() {
        const body = document.body || document.getElementsByTagName('body')[0];

        this.adContainer = document.createElement('div');
        this.adContainer.id = this.prefix + 'advertisement';
        this.adContainer.style.position = 'fixed';
        this.adContainer.style.zIndex = '99';
        this.adContainer.style.top = '0';
        this.adContainer.style.left = '0';
        this.adContainer.style.width = '100%';
        this.adContainer.style.height = '100%';
        this.adContainer.style.transform = 'translateX(-9999px)';
        this.adContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.adContainer.style.opacity = '0';
        this.adContainer.style.transition = 'opacity ' +
            this.containerTransitionSpeed +
            'ms cubic-bezier(0.55, 0, 0.1, 1)';

        const adContainerInner = document.createElement('div');
        adContainerInner.id = this.prefix + 'advertisement_slot';
        adContainerInner.style.position = 'absolute';
        adContainerInner.style.backgroundColor = '#000000';
        if (this.responsive || this.thirdPartyContainer) {
            adContainerInner.style.top = '0';
            adContainerInner.style.left = '0';
        } else {
            adContainerInner.style.left = '50%';
            adContainerInner.style.top = '50%';
            adContainerInner.style.transform = 'translate(-50%, -50%)';
            adContainerInner.style.boxShadow = '0 0 8px rgba(0, 0, 0, 1)';
        }
        adContainerInner.style.width = this.width + 'px';
        adContainerInner.style.height = this.height + 'px';

        this.adContainer.appendChild(adContainerInner);
        body.appendChild(this.adContainer);

        // We need to resize our adContainer
        // when the view dimensions change.
        window.addEventListener('resize', () => {
            this.width = window.innerWidth ||
                document.documentElement.clientWidth ||
                document.body.clientWidth;
            this.height = window.innerHeight ||
                document.documentElement.clientHeight ||
                document.body.clientHeight;
            adContainerInner.style.width = this.width + 'px';
            adContainerInner.style.height = this.height + 'px';
        });

        this._setUpIMA();
    }

    /**
     * _setUpIMA
     * Create's a the adsLoader object.
     * @private
     */
    _setUpIMA() {
        // In order for the SDK to display ads on our page, we need to tell
        // it where to put them. In the html above, we defined a div with
        // the id "adContainer". This div is set up to render on top of
        // the video player. Using the code below, we tell the SDK to render
        // ads in that div. Also provide a handle to the content video
        // player - the SDK will poll the current time of our player to
        // properly place mid-rolls. After we create the ad display
        // container, initialize it. On mobile devices, this initialization
        // must be done as the result of a user action! Which is done
        // at playAds().

        // So we can run VPAID2.
        google.ima.settings.setVpaidMode(
            google.ima.ImaSdkSettings.VpaidMode.ENABLED);

        // Set language.
        google.ima.settings.setLocale(this.locale);

        // We assume the adContainer is the DOM id of the element that
        // will house the ads.
        this.adDisplayContainer = new google.ima.AdDisplayContainer(
            document.getElementById(this.prefix + 'advertisement_slot'),
            this.videoElement,
        );

        // Here we create an AdsLoader and define some event listeners.
        // Then create an AdsRequest object to pass to this AdsLoader.
        // We'll then wire up the 'Play' button to
        // call our requestAds function.

        // We will maintain only one instance of AdsLoader for the entire
        // lifecycle of the page. To make additional ad requests, create a
        // new AdsRequest object but re-use the same AdsLoader.

        // Re-use this AdsLoader instance for the entire lifecycle of the page.
        this.adsLoader = new google.ima.AdsLoader(this.adDisplayContainer);

        // Add adsLoader event listeners.
        this.adsLoader.addEventListener(
            google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
            this._onAdsManagerLoaded, false, this);
        this.adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,
            this._onAdError, false, this);

        // Send event that adsLoader is ready.
        let eventName = 'AD_SDK_LOADER_READY';
        this.eventBus.broadcast(eventName, {
            name: eventName,
            message: this,
            status: 'success',
            analytics: {
                category: this.eventCategory,
                action: eventName,
                label: this.gameId,
            },
        });

        // Request new video ads to be pre-loaded.
        this.requestAds();
    }

    /**
     * requestAds
     * Request advertisements.
     * @public
     */
    requestAds() {
        if (typeof google === 'undefined') {
            this._onError('Unable to request ad, google IMA SDK not defined.');
            return;
        }

        // First check if we can run ads. If the video is embedded within a
        // Phone Gap/ Cordova app, then we're not allowed.
        if (navigator.userAgent.match(/Crosswalk/i) ||
            typeof window.cordova !== 'undefined') {
            this._onError('Navigator.userAgent contains Crosswalk and/ or ' +
                'window.cordova. We\'re not allowed to run advertisements ' +
                'within Cordova.');
            return;
        }

        try {
            // Request video new ads.
            const adsRequest = new google.ima.AdsRequest();

            // Update our adTag. We add additional parameters so Tunnl
            // can use the values as new metrics within reporting.
            this.adCount++;
            const positionCount = this.adCount - 1;
            this.tag = updateQueryStringParameter(this.tag, 'ad_count',
                this.adCount);
            this.tag = updateQueryStringParameter(this.tag, 'ad_position',
                (this.adCount === 1) ? 'preroll' : 'midroll' +
                    positionCount.toString());
            adsRequest.adTagUrl = this.tag;

            // Specify the linear and nonlinear slot sizes. This helps
            // the SDK to select the correct creative if multiple are returned.
            adsRequest.linearAdSlotWidth = this.width;
            adsRequest.linearAdSlotHeight = this.height;
            adsRequest.nonLinearAdSlotWidth = this.width;
            adsRequest.nonLinearAdSlotHeight = this.height;

            // We allow overlay ads.
            adsRequest.forceNonLinearFullSlot = false;

            // Get us some ads!
            this.adsLoader.requestAds(adsRequest);

            // Send event.
            let eventName = 'AD_SDK_LOADER_READY';
            this.eventBus.broadcast(eventName, {
                name: eventName,
                message: this.tag,
                status: 'success',
                analytics: {
                    category: this.eventCategory,
                    action: eventName,
                    label: this.gameId,
                },
            });
        } catch (e) {
            this._onAdError(e);
        }
    }

    /**
     * _onAdsManagerLoaded
     * This function is called whenever the ads are ready inside
     * the AdDisplayContainer.
     * @param {Event} adsManagerLoadedEvent
     * @private
     */
    _onAdsManagerLoaded(adsManagerLoadedEvent) {
        // Get the ads manager.
        const adsRenderingSettings = new google.ima.AdsRenderingSettings();
        adsRenderingSettings.enablePreloading = true;
        adsRenderingSettings.restoreCustomPlaybackStateOnAdBreakComplete = true;

        // We don't set videoContent as in the Google IMA example docs,
        // cause we run a game, not an ad.
        // todo: we will want to change this.
        this.adsManager = adsManagerLoadedEvent.getAdsManager(
            this.videoElement,
            adsRenderingSettings,
        );

        // Todo: dont know what this does lol.
        if (this.adsManager.isCustomClickTrackingUsed()) {
            this.customClickDiv.style.display = 'table';
        }

        // Add listeners to the required events.
        // https://developers.google.com/interactive-media-
        // ads/docs/sdks/html5/v3/apis

        // Advertisement error events.
        this.adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,
            this._onAdError.bind(this), false, this);

        // Advertisement regular events.
        this.adsManager.addEventListener(google.ima.AdEvent.Type.AD_BREAK_READY,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.AD_METADATA,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.ALL_ADS_COMPLETED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.CLICK,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.DURATION_CHANGE, this._onAdEvent.bind(this),
            this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.FIRST_QUARTILE,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.IMPRESSION,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.INTERACTION,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.LINEAR_CHANGED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.LOADED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.LOG,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.MIDPOINT,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.PAUSED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.RESUMED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.SKIPPABLE_STATE_CHANGED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.SKIPPED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.STARTED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.THIRD_QUARTILE,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.USER_CLOSE,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.VOLUME_CHANGED,
            this._onAdEvent.bind(this), this);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.VOLUME_MUTED,
            this._onAdEvent.bind(this), this);

        // We need to resize our adContainer when the view dimensions change.
        window.addEventListener('resize', () => {
            this.adsManager.resize(
                this.width,
                this.height,
                google.ima.ViewMode.NORMAL,
            );
        });

        // Once the ad display container is ready and ads have been retrieved,
        // we can use the ads manager to display the ads.
        if (this.adsManager && this.adDisplayContainer) {
            // Reset attempts as we've successfully setup the adsloader (again).
            this.requestAttempts = 0;
            let eventName = 'AD_SDK_MANAGER_READY';
            this.eventBus.broadcast(eventName, {
                name: eventName,
                message: this.adsManager,
                status: 'success',
                analytics: {
                    category: this.eventCategory,
                    action: eventName,
                    label: this.gameId,
                },
            });
        }
    }

    /**
     * _onAdEvent
     * This is where all the event handling takes place. Retrieve the ad from
     * the event. Some events (e.g. ALL_ADS_COMPLETED) don't have ad
     * object associated.
     * @param {Event} adEvent
     * @private
     */
    _onAdEvent(adEvent) {
        let eventName = '';
        let eventMessage = '';
        switch (adEvent.type) {
        case google.ima.AdEvent.Type.AD_BREAK_READY:
            eventName = 'AD_BREAK_READY';
            eventMessage = 'Fired when an ad rule or a VMAP ad break would ' +
                'have played if autoPlayAdBreaks is false.';
            break;
        case google.ima.AdEvent.Type.AD_METADATA:
            eventName = 'AD_METADATA';
            eventMessage = 'Fired when an ads list is loaded.';
            break;
        case google.ima.AdEvent.Type.ALL_ADS_COMPLETED:
            eventName = 'ALL_ADS_COMPLETED';
            eventMessage = 'Fired when the ads manager is done playing all ' +
                'the ads.';
            break;
        case google.ima.AdEvent.Type.CLICK:
            eventName = 'CLICK';
            eventMessage = 'Fired when the ad is clicked.';
            break;
        case google.ima.AdEvent.Type.COMPLETE:
            eventName = 'COMPLETE';
            eventMessage = 'Fired when the ad completes playing.';
            break;
        case google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED:
            eventName = 'CONTENT_PAUSE_REQUESTED';
            eventMessage = 'Fired when content should be paused. This ' +
                'usually happens right before an ad is about to cover ' +
                'the content.';
            break;
        case google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED:
            eventName = 'CONTENT_RESUME_REQUESTED';
            eventMessage = 'Fired when content should be resumed. This ' +
                'usually happens when an ad finishes or collapses.';

            // Hide the advertisement.
            if (this.adContainer) {
                this.adContainer.style.opacity = '0';
                setTimeout(() => {
                    // We do not use display none. Otherwise element.offsetWidth
                    // and height will return 0px.
                    this.adContainer.style.transform =
                        'translateX(-9999px)';
                }, this.containerTransitionSpeed);
            }

            // Destroy the adsManager so we can grab new ads after this.
            // If we don't then we're not allowed to call new ads based
            // on google policies, as they interpret this as an accidental
            // video requests. https://developers.google.com/interactive-
            // media-ads/docs/sdks/android/faq#8
            Promise.all([
                this.adsLoaderPromise,
                this.adsManagerPromise,
            ]).then(() => {
                if (this.adsLoader) {
                    // this.adsLoader.contentComplete();
                }

                this.adsLoaderPromise = new Promise((resolve) => {
                    // Wait for adsLoader to be loaded.
                    this.eventBus.subscribe('AD_SDK_LOADER_READY',
                        (arg) => resolve());
                });
                this.adsManagerPromise = new Promise((resolve) => {
                    // Wait for adsManager to be loaded.
                    this.eventBus.subscribe('AD_SDK_MANAGER_READY',
                        (arg) => resolve());
                });

                // Preload new ads by doing a new request.
                // this.requestAds();

                // Send event to tell that the whole advertisement
                // thing is finished.
                let eventName = 'AD_SDK_FINISHED';
                let eventMessage = 'IMA is ready for new requests.';
                this.eventBus.broadcast(eventName, {
                    name: eventName,
                    message: eventMessage,
                    status: 'success',
                    analytics: {
                        category: this.eventCategory,
                        action: eventName,
                        label: this.gameId,
                    },
                });
            }).catch((error) => console.log(error));

            break;
        case google.ima.AdEvent.Type.DURATION_CHANGE:
            eventName = 'DURATION_CHANGE';
            eventMessage = 'Fired when the ad\'s duration changes.';
            break;
        case google.ima.AdEvent.Type.FIRST_QUARTILE:
            eventName = 'FIRST_QUARTILE';
            eventMessage = 'Fired when the ad playhead crosses first ' +
                'quartile.';
            break;
        case google.ima.AdEvent.Type.IMPRESSION:
            eventName = 'IMPRESSION';
            eventMessage = 'Fired when the impression URL has been pinged.';
            break;
        case google.ima.AdEvent.Type.INTERACTION:
            eventName = 'INTERACTION';
            eventMessage = 'Fired when an ad triggers the interaction ' +
                'callback. Ad interactions contain an interaction ID ' +
                'string in the ad data.';
            break;
        case google.ima.AdEvent.Type.LINEAR_CHANGED:
            eventName = 'LINEAR_CHANGED';
            eventMessage = 'Fired when the displayed ad changes from ' +
                'linear to nonlinear, or vice versa.';
            break;
        case google.ima.AdEvent.Type.LOADED:
            console.info('Ad type: ' +
                adEvent.getAd().getAdPodInfo().getPodIndex());
            console.info('Ad time: ' +
                adEvent.getAd().getAdPodInfo().getTimeOffset());
            eventName = 'LOADED';
            eventMessage = adEvent.getAd().getContentType();
            break;
        case google.ima.AdEvent.Type.LOG:
            const adData = adEvent.getAdData();
            if (adData['adError']) {
                eventName = 'LOG';
                eventMessage = adEvent.getAdData();
            }
            break;
        case google.ima.AdEvent.Type.MIDPOINT:
            eventName = 'MIDPOINT';
            eventMessage = 'Fired when the ad playhead crosses midpoint.';
            break;
        case google.ima.AdEvent.Type.PAUSED:
            eventName = 'PAUSED';
            eventMessage = 'Fired when the ad is paused.';
            break;
        case google.ima.AdEvent.Type.RESUMED:
            eventName = 'RESUMED';
            eventMessage = 'Fired when the ad is resumed.';
            break;
        case google.ima.AdEvent.Type.SKIPPABLE_STATE_CHANGED:
            eventName = 'SKIPPABLE_STATE_CHANGED';
            eventMessage = 'Fired when the displayed ads skippable state ' +
                'is changed.';
            break;
        case google.ima.AdEvent.Type.SKIPPED:
            eventName = 'SKIPPED';
            eventMessage = 'Fired when the ad is skipped by the user.';
            break;
        case google.ima.AdEvent.Type.STARTED:
            eventName = 'STARTED';
            eventMessage = 'Fired when the ad starts playing.';
            break;
        case google.ima.AdEvent.Type.THIRD_QUARTILE:
            eventName = 'THIRD_QUARTILE';
            eventMessage = 'Fired when the ad playhead crosses third ' +
                'quartile.';
            break;
        case google.ima.AdEvent.Type.USER_CLOSE:
            eventName = 'USER_CLOSE';
            eventMessage = 'Fired when the ad is closed by the user.';
            break;
        case google.ima.AdEvent.Type.VOLUME_CHANGED:
            eventName = 'VOLUME_CHANGED';
            eventMessage = 'Fired when the ad volume has changed.';
            break;
        case google.ima.AdEvent.Type.VOLUME_MUTED:
            eventName = 'VOLUME_MUTED';
            eventMessage = 'Fired when the ad volume has been muted.';
            break;
        }

        // Send the event to our eventBus.
        if (eventName !== '' && eventMessage !== '') {
            this.eventBus.broadcast(eventName, {
                name: eventName,
                message: eventMessage,
                status: 'success',
                analytics: {
                    category: this.eventCategory,
                    action: eventName,
                    label: this.gameId,
                },
            });
        }
    }

    /**
     * _onAdError
     * Any ad error handling comes through here.
     * @param {Event} adErrorEvent
     * @private
     */
    _onAdError(adErrorEvent) {
        let eventName = 'AD_ERROR';
        let eventMessage = adErrorEvent.getError();
        this.eventBus.broadcast(eventName, {
            name: eventName,
            message: eventMessage,
            status: 'warning',
            analytics: {
                category: this.eventCategory,
                action: eventName,
                label: eventMessage,
            },
        });
        this.cancel();
        this._clearSafetyTimer('AD_ERROR');
    }

    /**
     * _onError
     * Any error handling comes through here.
     * @param {String} message
     * @private
     */
    _onError(message) {
        let eventName = 'AD_SDK_ERROR';
        this.eventBus.broadcast(eventName, {
            name: eventName,
            message: message,
            status: 'error',
            analytics: {
                category: this.eventCategory,
                action: eventName,
                label: message,
            },
        });
        this.cancel();
        this._clearSafetyTimer('AD_SDK_ERROR');
    }

    /**
     * _startSafetyTimer
     * Setup a safety timer for when the ad network
     * doesn't respond for whatever reason. The advertisement has 12 seconds
     * to get its shit together. We stop this timer when the advertisement
     * is playing, or when a user action is required to start, then we
     * clear the timer on ad ready.
     * @param {Number} time
     * @param {String} from
     * @private
     */
    _startSafetyTimer(time, from) {
        dankLog('AD_SAFETY_TIMER', 'Invoked timer from: ' + from,
            'success');
        this.safetyTimer = window.setTimeout(() => {
            let eventName = 'AD_SAFETY_TIMER';
            let eventMessage = 'Advertisement took too long to load.';
            this.eventBus.broadcast(eventName, {
                name: eventName,
                message: eventMessage,
                status: 'warning',
                analytics: {
                    category: this.eventCategory,
                    action: eventName,
                    label: this.gameId,
                },
            });
            this.cancel();
            this._clearSafetyTimer('AD_SAFETY_TIMER');
        }, time);
    }

    /**
     * _clearSafetyTimer
     * @param {String} from
     * @private
     */
    _clearSafetyTimer(from) {
        if (typeof this.safetyTimer !== 'undefined' &&
            this.safetyTimer !== null) {
            dankLog('AD_SAFETY_TIMER', 'Cleared timer from: ' + from,
                'success');
            clearTimeout(this.safetyTimer);
            this.safetyTimer = undefined;
        }
    }
}

export default VideoAd;