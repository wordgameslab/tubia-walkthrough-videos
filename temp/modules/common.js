/* eslint-disable */
function extendDefaults(source, properties) {
    let property;
    for (property in properties) {
        if (properties.hasOwnProperty(property)) {
            if(properties[property] !== null &&
                typeof properties[property] !== 'undefined') {
                source[property] = properties[property];
            }
        }
    }
    return source;
}

function getCookie(name) {
    var nameEQ = name + '=';
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function getParentUrl() {
    let url = (window.location !== window.parent.location)
        ? (document.referrer && document.referrer !== '')
            ? document.referrer
            : document.location.href
        : document.location.href;
    // If the referrer is gameplayer.io. (Spil Games)
    if (document.referrer.indexOf('gameplayer.io') !== -1) {
        url = 'https://gamedistribution.com/';
        // Now check if they provide us with a referrer URL.
        if (document.referrer.indexOf('?ref=') !== -1) {
            let returnedResult = document.referrer.substr(document.referrer.indexOf(
                '?ref=') + 5);
            // Guess sometimes they can give us empty or wrong values.
            if (returnedResult !== '' &&
                returnedResult !== '{portal%20name}' &&
                returnedResult !== '{portal name}') {
                returnedResult = fullyDecodeURI(returnedResult);
                url = (returnedResult.indexOf('http') === -1) ? 'http://' +
                    returnedResult : returnedResult;
            }
        }
    } else if(document.referrer.indexOf('localhost') !== -1) {
        url = 'https://gamedistribution.com/';
    }
    return url;
}

function updateQueryStringParameter(uri, key, value) {
    const re = new RegExp('([?&])' + key + '=.*?(&|$)', 'i');
    const separator = uri.indexOf('?') !== -1 ? '&' : '?';
    if (uri.match(re)) {
        return uri.replace(re, '$1' + key + '=' + value + '$2');
    } else {
        return uri + separator + key + '=' + value;
    }
}

export {
    extendDefaults,
    getCookie,
    getParentUrl,
    updateQueryStringParameter,
};
/* eslint-enable */