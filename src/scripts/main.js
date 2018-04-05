import 'es6-promise/auto';
import 'whatwg-fetch';
import 'rangetouch';

import PackageJSON from '../../package.json';
import Plyr from './plyr/plyr';
import utils from './plyr/utils';

const instance = null;

/**
 * Tubia
 */
class Tubia {
    /**
     * Constructor of Tubia.
     * @param {Object} options
     * @return {*}
     */
    constructor(options) {
        // Make this a singleton.
        if (instance) {
            return instance;
        }

        // Set some defaults. We replace them with real given
        // values further down.
        const defaults = {
            debug: true,
            container: 'player',
            gameId: '',
            publisherId: '',
            title: '',
            category: '',
            langCode: '',
            colorMain: '',
            colorAccent: '',
            domain: 'bgames.com',
            // domain: window.location.href.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0],
            onFound() {
            },
            onError() {
            },
            onReady() {
            },
        };

        if (options) {
            this.options = utils.extendDefaults(defaults, options);
        } else {
            this.options = defaults;
        }

        // Set a version banner within the developer console.
        /* eslint-disable */
        const version = PackageJSON.version;
        const banner = console.log(
            '%c %c %c Tubia Video Walkthrough | Version: ' +
            version + ' %c %c %c', 'background: #01567d',
            'background: #00405c', 'color: #fff; background: #002333;',
            'background: #00405c', 'background: #01567d',
            'background: #006897');
        console.log.apply(console, banner);
        /* eslint-enable */

        this.container = document.getElementById(this.options.container);
        this.url = document.location.href;
        this.adTag = null;
        this.posterUrl = '';
        this.posterImageElement = null;
        this.transitionElement = null;
        this.playButton = null;
        this.hexagonLoader = null;
        this.videoSearchPromise = null;
        this.videoDataPromise = null;
        this.transitionSpeed = 2000;
        this.startPlyrHandler = this.startPlyr.bind(this);

        if (this.container) {
            // Add our main class to our clients container.
            this.container.classList.add('tubia__');
        } else {
            return false;
        }

        // Call Google Analytics and Death Star.
        this.analytics();

        // Load our styles first. So we don't get initial load flickering.
        utils.loadStyle('https://fonts.googleapis.com/css?family=Khand:400,700');
        utils.loadStyle('https://tubia.gamedistribution.com/libs/gd/main.min.css').then(() => {
            // Start our application. We load the player when the user clicks,
            // as we don't want too many requests for our assets.
            this.start();
        }).catch((error) => {
            this.onError(error);
        });

        // Set theme styles.
        if(this.options.colorMain !== '' && this.options.colorAccent !== '') {
            const css = `
                .tubia__ .tubia__transition:after {
                    background-color: ${this.options.colorMain};
                }
                .tubia__ .tubia__transition:before {
                    background-color: ${this.options.colorAccent};
                }
                .tubia__ .tubia__play-button .tubia__hexagon .tubia__hexagon-base, 
                .tubia__ .tubia__play-button .tubia__hexagon .tubia__hexagon-line-animation,
                .plyr .plyr__hexagon .plyr__hexagon-base {
                    fill: ${this.options.colorMain};
                    stroke: ${this.options.colorMain};
                }
                .tubia__ .tubia__hexagon-loader .tubia__hexagon .tubia__hexagon-base,
                .plyr .plyr__hexagon .plyr__hexagon-base {
                    stroke: ${this.options.colorMain};
                }
                .tubia__ .tubia__hexagon-loader .tubia__hexagon .tubia__hexagon-line-animation,
                .plyr .plyr__hexagon .plyr__hexagon-line-animation {
                    stroke: ${this.options.colorAccent};
                }
                .plyr--full-ui input[type=range] {
                    color: ${this.options.colorMain};
                }
                .plyr__menu__container {
                    background: ${this.options.colorMain};
                }
                .plyr__menu__container:after {
                    border-top-color: ${this.options.colorMain};
                }
                .plyr__playlist ul li.active .plyr__count {
                    border-color: ${this.options.colorMain};
                    background-color: ${this.options.colorMain};
                }
                .plyr__playlist ul li:active .plyr__count {
                    border-color: ${this.options.colorAccent};
                }
                .plyr__playlist:before {
                    background-color: ${this.options.colorAccent};
                }
                .plyr__playlist:after {
                    background-color: ${this.options.colorMain};
                }
            `;
            // Add css
            const head = document.head || document.getElementsByTagName('head')[0];
            const style = document.createElement('style');
            style.type = 'text/css';
            if (style.styleSheet) {
                style.styleSheet.cssText = css;
            } else {
                style.appendChild(document.createTextNode(css));
            }
            head.appendChild(style);
        }
    }

    /**
     * start
     * Start the Tubia application.
     */
    start() {
        const html = `
            <div class="tubia__transition"></div>
            <button class="tubia__play-button">
                <svg class="tubia__play-icon" viewBox="0 0 18 18" version="1.1" xmlns="http://www.w3.org/2000/svg">
                    <g>
                        <path d="M15.5615866,8.10002147 L3.87056367,0.225209313 C3.05219207,-0.33727727 2,0.225209313 2,1.12518784 L2,16.8748122 C2,17.7747907 3.05219207,18.3372773 3.87056367,17.7747907 L15.5615866,9.89997853 C16.1461378,9.44998927 16.1461378,8.55001073 15.5615866,8.10002147 L15.5615866,8.10002147 Z"/>
                    </g>
                </svg>
                <svg class="tubia__hexagon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 129.78 150.37">
                    <path class="tubia__hexagon-base" d="M-1665.43,90.94V35.83a15.09,15.09,0,0,1,6.78-12.59l48.22-31.83a15.09,15.09,0,0,1,16-.38L-1547,19.13a15.09,15.09,0,0,1,7.39,13V90.94a15.09,15.09,0,0,1-7.21,12.87l-47.8,29.24a15.09,15.09,0,0,1-15.75,0l-47.8-29.24A15.09,15.09,0,0,1-1665.43,90.94Z" transform="translate(1667.43 13.09)"/>
                    <path class="tubia__hexagon-line-animation" d="M-1665.43,90.94V35.83a15.09,15.09,0,0,1,6.78-12.59l48.22-31.83a15.09,15.09,0,0,1,16-.38L-1547,19.13a15.09,15.09,0,0,1,7.39,13V90.94a15.09,15.09,0,0,1-7.21,12.87l-47.8,29.24a15.09,15.09,0,0,1-15.75,0l-47.8-29.24A15.09,15.09,0,0,1-1665.43,90.94Z" transform="translate(1667.43 13.09)"/>
                </svg>
            </button>
            <div class="tubia__hexagon-loader">
                <svg class="tubia__hexagon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 129.78 150.37">
                    <path class="tubia__hexagon-base" d="M-1665.43,90.94V35.83a15.09,15.09,0,0,1,6.78-12.59l48.22-31.83a15.09,15.09,0,0,1,16-.38L-1547,19.13a15.09,15.09,0,0,1,7.39,13V90.94a15.09,15.09,0,0,1-7.21,12.87l-47.8,29.24a15.09,15.09,0,0,1-15.75,0l-47.8-29.24A15.09,15.09,0,0,1-1665.43,90.94Z" transform="translate(1667.43 13.09)"/>
                    <path class="tubia__hexagon-line-animation" d="M-1665.43,90.94V35.83a15.09,15.09,0,0,1,6.78-12.59l48.22-31.83a15.09,15.09,0,0,1,16-.38L-1547,19.13a15.09,15.09,0,0,1,7.39,13V90.94a15.09,15.09,0,0,1-7.21,12.87l-47.8,29.24a15.09,15.09,0,0,1-15.75,0l-47.8-29.24A15.09,15.09,0,0,1-1665.43,90.94Z" transform="translate(1667.43 13.09)"/>
                </svg>
            </div>
        `;

        this.container.insertAdjacentHTML('beforeend', html);
        this.transitionElement = this.container.querySelector('.tubia__transition');
        this.playButton = this.container.querySelector('.tubia__play-button');
        this.hexagonLoader = this.container.querySelector('.tubia__hexagon-loader');

        // Show the container.
        this.container.classList.toggle('tubia__active');

        // Show a spinner loader, as this could take some time.
        this.hexagonLoader.classList.toggle('tubia__active');

        // Search for a matching game within our Tubia database and return the id.
        // Todo: We can't get the poster image without doing these requests for data. Kind of sucks.
        this.videoSearchPromise = new Promise((resolve, reject) => {
            const gameId = this.options.gameId.toString().replace(/-/g, '');
            const title = encodeURIComponent(this.options.title);
            const domain = encodeURIComponent(this.options.domain);
            utils.loadScript('https://tubia.gamedistribution.com/libs/gd/md5.js').then(() => {
                const pageId = window.calcMD5(this.url);
                const videoFindUrl = `https://walkthrough.gamedistribution.com/api/player/findv3/?pageId=${pageId}&gameId=${gameId}&title=${title}&domain=${domain}`;
                const videoSearchRequest = new Request(videoFindUrl, {
                    method: 'GET',
                });
                fetch(videoSearchRequest).then((response) => {
                    const contentType = response.headers.get('content-type');
                    if (!contentType || !contentType.includes('application/json')) {
                        reject();
                        throw new TypeError('Oops, we didn\'t get JSON!');
                    } else {
                        return response.json();
                    }
                }).then((json) => {
                    resolve(json);
                }).catch((error) => {
                    this.onError(error);
                    reject();
                });
            }).catch((error) => {
                this.onError(error);
            });
        });

        // Get the video data using the id returned from the videoSearchPromise.
        this.videoDataPromise = new Promise((resolve, reject) => {
            // Todo: check if we dont want to use a tubia url.
            // Todo: verify if tubia cdn urls are ssl ready.
            // Todo: make sure to disable ads if enableAds is false. Also for addFreeActive :P
            // Todo: The SSL certificate used to load resources from https://cdn.walkthrough.vooxe.com will be distrusted in M70. Once distrusted, users will be prevented from loading these resources. See https://g.co/chrome/symantecpkicerts for more information.
            this.videoSearchPromise.then((id) => {
                const gameId = (typeof id !== 'undefined' && id.gameId && id.gameId !== '') ? id.gameId.toString().replace(/-/g, '') : this.options.gameId.toString().replace(/-/g, '');
                const publisherId = this.options.publisherId.toString().replace(/-/g, '');
                const domain = encodeURIComponent(this.options.domain);
                const location = encodeURIComponent(this.url);
                const videoDataUrl = `https://walkthrough.gamedistribution.com/api/player/publish/?gameid=${gameId}&publisherid=${publisherId}&domain=${domain}`;
                const videoDataRequest = new Request(videoDataUrl, {method: 'GET'});

                // Record Tubia view event in Tunnl.
                (new Image()).src = `https://ana.tunnl.com/event?tub_id=${gameId}&eventtype=0&page_url=${location}`;

                // Set the ad tag using the given id.
                this.adTag = `https://pub.tunnl.com/opp?page_url=${encodeURIComponent(this.url)}&player_width=640&player_height=480&game_id=${gameId}&correlator=${Date.now()}`;
                // this.adTag = `https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/ad_rule_samples&ciu_szs=300x250&ad_rule=1&impl=s&gdfp_req=1&env=vp&output=vmap&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_ar%3Dpremidpostpod&cmsid=496&vid=short_onecue&correlator=${Date.now()}`;
                // this.adTag = 'https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/ad_rule_samples&ciu_szs=300x250&ad_rule=1&impl=s&gdfp_req=1&env=vp&output=vmap&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_ar%3Dpreonly&cmsid=496&vid=short_onecue&correlator=';
                fetch(videoDataRequest).then((response) => {
                    const contentType = response.headers.get('content-type');
                    if (!contentType || !contentType.includes('application/json')) {
                        reject();
                        throw new TypeError('Oops, we didn\'t get JSON!');
                    } else {
                        return response.json();
                    }
                }).then(json => {
                    console.log(json);
                    resolve(json);
                }).catch((error) => {
                    this.onError(error);
                    reject(error);
                });
            }).catch((error) => {
                this.onError(error);
            });
        });

        // We start with showing a poster image with a play button.
        // By not loading the actual player we save some requests and overall page load.
        // A user can click the play button to start loading the video player.
        // Todo: Enable autoplay when possible.
        this.videoDataPromise.then((json) => {
            if (!json) {
                this.onError('No video has been found!');
                return;
            }

            const poster = (json.pictures && json.pictures.length > 0) ? json.pictures[json.pictures.length - 1].link : '';
            this.posterUrl = poster.replace(/^http:\/\//i, 'https://');

            // Load the poster image.
            this.posterImageElement = document.createElement('img');
            this.posterImageElement.classList.add('tubia__poster');
            const checkImage = path =>
                new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => resolve({path, status: 'ok'});
                    img.onerror = () => resolve({path, status: 'error'});
                    img.src = path;
                });
            const loadImg = (...paths) => Promise.all(paths.map(checkImage));
            loadImg(this.posterUrl).then((response) => {
                if (response[0].status === 'ok') {
                    this.posterImageElement.src = response[0].path;
                } else {
                    this.posterImageElement.style.display = 'none';
                }

                // Start transition towards showing the poster image.
                this.transitionElement.classList.toggle('tubia__active');

                setTimeout(() => {
                    // Hide our spinner loader.
                    this.hexagonLoader.classList.toggle('tubia__active');
                    // Add our poster image.
                    this.container.appendChild(this.posterImageElement);

                    // Create the play button.
                    // Todo: hide button when done.
                    this.playButton.classList.toggle('tubia__active');
                    this.playButton.addEventListener('click', this.startPlyrHandler, false);
                }, this.transitionSpeed / 2);

                setTimeout(() => {
                    // Hide transition.
                    this.transitionElement.classList.toggle('tubia__active');
                }, this.transitionSpeed);
            });
        });
    }

    /**
     * onError
     * Whenever we hit a problem while initializing Tubia.
     * @param {String} error
     */
    onError(error) {
        // Todo: I think Plyr has some error handling div.
        this.options.onError(error);
        if (this.container) {
            this.container.classList.toggle = 'tubia__error';
        }
    }

    /**
     * startPlyr
     * Method for animating into loading the Plyr player.
     */
    startPlyr() {
        if(!this.playButton) {
            return;
        }

        // Remove our click listener to avoid double clicks.
        this.playButton.removeEventListener('click', this.startPlyrHandler, false);

        // Hide the play button.
        this.playButton.classList.toggle('tubia__active');
        // Show transition
        this.transitionElement.classList.toggle('tubia__active');

        setTimeout(() => {
            // Show our spinner loader.
            this.hexagonLoader.classList.toggle('tubia__active');
            // Hide the poster image.
            this.posterImageElement.style.display = 'none';
            // Remove the button.
            this.playButton.parentNode.removeChild(this.playButton);
        }, this.transitionSpeed / 2);

        setTimeout(() => {
            // Hide transition.
            this.transitionElement.classList.toggle('tubia__active');
            // Load our player.
            this.loadPlyr();
        }, this.transitionSpeed);
    }

    /**
     * loadPlyr
     * Load the Plyr library.
     */
    loadPlyr() {
        // Todo: Add tubia related videos
        // //walkthrough.gamedistribution.com/api/RelatedVideo/?gameMd5=" + A + "&publisherId=" + G
        // + "&domain=" + b + "&skip=0&take=5&orderBy=visit&sortDirection=desc&langCode=" + aa

        // Todo: Add tubia error reporting
        // //walkthrough.gamedistribution.com/api/playernotification?reasonid=" + b + "&url=" +
        // encodeURIComponent(q()) + "&videoid=" + A

        // Send a post request to tell the "matching"-team which video is becoming important.
        // It is basically for updating a click counter or whatever :P
        // const videoCounterData = {
        //     publisherId: this.options.publisherId,
        //     url: document.location.href,
        //     title: this.options.title,
        //     gameId: this.options.gameId,
        //     category: this.options.category,
        //     langCode: this.options.langCode,
        // };
        const videoCounterData = `publisherId=${this.options.publisherId}&url=${encodeURIComponent(this.url)}&title=${this.options.title}&gameId=${this.options.gameId}&category=${this.options.category}&langCode=${this.options.langCode}`;
        // Todo: Triodor has not yet deployed the preflight request update!
        const videoCounterUrl = 'https://walkthrough.gamedistribution.com/api/player/findv3/';
        const videoCounterRequest = new Request(videoCounterUrl, {
            method: 'POST',
            body: videoCounterData, // JSON.stringify(videoCounterData),
            headers: new Headers({
                'Content-Type': 'application/x-www-form-urlencoded', // application/json
            }),
        });
        fetch(videoCounterRequest).then((response) => {
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new TypeError('Oops, we didn\'t get JSON!');
            } else {
                return response.json();
            }
        }).catch((error) => {
            this.onError(error);
        });

        this.videoDataPromise.then((json) => {
            if (!json) {
                this.onError('No video has been found!');
                return;
            }

            // Create the HTML5 video element.
            const videoElement = document.createElement('video');
            videoElement.setAttribute('controls', 'true');
            videoElement.setAttribute('crossorigin', 'true');
            videoElement.setAttribute('playsinline', 'true');
            videoElement.poster = this.posterUrl;
            videoElement.id = 'plyr__tubia';

            // Todo: If files (transcoded videos) doesn't exist we must load the raw video file.
            // Todo: However, currently the raw files are in the wrong google project and not served from a CDN, so expensive!
            const videoSource = document.createElement('source');
            const source = (json.files && json.files.length > 0) ? json.files[json.files.length - 1].linkSecure : `https://storage.googleapis.com/vooxe_eu/vids/default/${json.detail[0].mediaURL}`;
            const sourceUrl = source.replace(/^http:\/\//i, 'https://');
            const sourceType = (json.files && json.files.length > 0) ? json.files[json.files.length - 1].type : 'video/mp4';
            videoSource.src = sourceUrl;
            videoSource.type = sourceType;

            videoElement.appendChild(videoSource);
            this.container.appendChild(videoElement);

            console.log(`Tubia video: ${source}`);

            // Create the video player.
            const controls = [
                'logo',
                'playlist',
                'play-large',
                'title',
                'progress',
                'current-time',
                'duration',
                'mute',
                'fullscreen',
            ];
            const playlist = {
                active: false,
                data: (json.cuepoints && json.cuepoints.length > 0) ? json.cuepoints : [],
            };

            // We don't want certain options when our view is too small.
            if ((this.container.offsetWidth >= 768)) {
                controls.push('volume');
                controls.push('settings');
                controls.push('captions');
                controls.push('pip');

                playlist.active = (json.cuepoints && json.cuepoints.length > 0);
            }

            // Create the Plyr instance.
            this.player = new Plyr('#plyr__tubia', {
                debug: this.options.debug,
                iconUrl: 'https://tubia.gamedistribution.com/libs/gd/sprite.svg',
                title: (json.detail && json.detail.length > 0) ? json.detail[0].title : '',
                logo: json.logoEnabled,
                showPosterOnEnd: true,
                hideControls: false,
                ads: {
                    enabled: json.adsEnabled,
                    video: json.preRollEnabled,
                    overlay: json.subBannerEnabled,
                    videoInterval: json.preRollSecond,
                    overlayInterval: json.subBannerSecond,
                    tag: (json.adsEnabled && !json.addFreeActive) ? this.adTag : '',
                },
                keyboard: {
                    global: true,
                },
                tooltips: {
                    seek: true,
                    controls: false,
                },
                captions: {
                    active: true,
                },
                fullscreen: {
                    enabled: json.fullScreenEnabled,
                },
                playlist,
                controls,
            });

            // Set some listeners.
            this.player.on('ready', () => {
                // Start transition towards showing the player.
                this.transitionElement.classList.toggle('tubia__active');

                setTimeout(() => {
                    // Hide our spinner loader.
                    this.hexagonLoader.classList.toggle('tubia__active');
                }, this.transitionSpeed / 2);

                setTimeout(() => {
                    // Hide transition.
                    this.transitionElement.classList.toggle('tubia__active');
                    // Permanently hide the transition.
                    this.transitionElement.style.display = 'none';
                    // Show the player.
                    this.player.elements.container.classList.toggle('tubia__active');
                    // Return ready callback for our clients.
                    this.options.onReady(this.player);
                    // Start playing.
                    this.player.play();
                }, this.transitionSpeed / 1.5);
            });
            this.player.on('error', (error) => {
                this.onError(error);
            });
        }).catch(error => {
            this.onError(error);
        });
    }

    /**
     * Analytics
     * Load Google Analytics and OrangeGames analytics.
     */
    analytics() {
        /* eslint-disable */
        // Load Google Analytics so we can push out a Google event for
        // each of our events.
        if (typeof window['ga'] === 'undefined') {
            (function (i, s, o, g, r, a, m) {
                i['GoogleAnalyticsObject'] = r;
                i[r] = i[r] || function () {
                    (i[r].q = i[r].q || []).push(arguments);
                }, i[r].l = 1 * new Date();
                a = s.createElement(o),
                    m = s.getElementsByTagName(o)[0];
                a.async = true;
                a.src = g;
                m.parentNode.insertBefore(a, m);
            })(window, document, 'script',
                'https://www.google-analytics.com/analytics.js', 'ga');
        }
        window['ga']('create', 'UA-102831738-1', {'name': 'tubia'}, 'auto');
        // Inject Death Star id's to the page view.
        const lcl = utils.getCookie('brzcrz_local');
        if (lcl) {
            window['ga']('tubia.set', 'userId', lcl);
            window['ga']('tubia.set', 'dimension1', lcl);
        }
        window['ga']('tubia.send', 'pageview');

        // Project Death Star.
        // https://bitbucket.org/keygamesnetwork/datacollectionservice
        const script = document.createElement('script');
        script.innerHTML = `
            var DS_OPTIONS = {
                id: 'TUBIA',
                success: function(id) {
                    window['ga']('tubia.set', 'userId', id); 
                    window['ga']('tubia.set', 'dimension1', id);
                    window['ga']('tubia.set', 'dimension2', '${this.options.category.toLowerCase()}');
                }
            }
        `;
        document.head.appendChild(script);

        // Load Death Star
        (function (window, document, element, source) {
            const ds = document.createElement(element);
            const m = document.getElementsByTagName(element)[0];
            ds.type = 'text/javascript';
            ds.async = true;
            ds.src = source;
            m.parentNode.insertBefore(ds, m);
        })(window, document, 'script',
            'https://game.gamemonkey.org/static/main.min.js');
        /* eslint-enable */
    }
}

export default Tubia;

/* eslint-disable */
const settings = (typeof TUBIA_OPTIONS === 'object' && TUBIA_OPTIONS)
    ? TUBIA_OPTIONS
    : (window.gdPlayer && typeof window.gdPlayer.q[0][0] === 'object' &&
        window.gdPlayer.q[0][0])
        ? window.gdPlayer.q[0][0]
        : {};
/* eslint-enable */

window.tubia = new Tubia(settings);

// Bind new namespace to our old one.
window.gdPlayer = window.tubia;