/**
 * IFrame Player API loading.
 *
 * The API hands control back through a single global callback, so the load is
 * wrapped in a promise once and shared by everyone who needs it.
 */

let readyPromise = null;

/**
 * Inject the IFrame API and resolve once `YT` is usable. Safe to call repeatedly.
 * @returns {Promise<any>} the YT namespace
 */
export function loadApi() {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => reject(new Error('could not reach YouTube - are you online?'));
    document.head.appendChild(tag);
  });

  return readyPromise;
}

/** True once a player can be constructed. */
export function isReady() {
  return Boolean(window.YT && window.YT.Player);
}

/**
 * @param {string|HTMLElement} target element or element id
 * @param {object} options YT.Player options
 */
export function newPlayer(target, options) {
  return new window.YT.Player(target, options);
}

/** The YT.PlayerState enum, or an empty object before the API loads. */
export function playerStates() {
  return (window.YT && window.YT.PlayerState) || {};
}

/**
 * Human-readable text for an onError payload.
 * @param {number} code
 */
export function describeError(code) {
  return {
    2:   'invalid playlist or video ID',
    5:   'playback error in the HTML5 player',
    100: 'not found - deleted or private',
    101: 'the owner disabled embedding',
    150: 'the owner disabled embedding'
  }[code] || `player error ${code}`;
}
