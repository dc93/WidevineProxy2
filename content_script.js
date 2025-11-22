function uint8ArrayToBase64(uint8array) {
    return btoa(String.fromCharCode.apply(null, uint8array));
}

function uint8ArrayToString(uint8array) {
    return String.fromCharCode.apply(null, uint8array)
}

function base64toUint8Array(base64_string){
    return Uint8Array.from(atob(base64_string), c => c.charCodeAt(0))
}

function compareUint8Arrays(arr1, arr2) {
    if (arr1.length !== arr2.length)
        return false;
    return Array.from(arr1).every((value, index) => value === arr2[index]);
}

function emitAndWaitForResponse(type, data, videoName = null) {
    return new Promise((resolve) => {
        const requestId = Math.random().toString(16).substring(2, 9);
        const responseHandler = (event) => {
            const { detail } = event;
            if (detail.substring(0, 7) === requestId) {
                document.removeEventListener('responseReceived', responseHandler);
                resolve(detail.substring(7));
            }
        };
        document.addEventListener('responseReceived', responseHandler);
        const requestEvent = new CustomEvent('response', {
            detail: {
                type: type,
                body: data,
                requestId: requestId,
                videoName: videoName,
            }
        });
        document.dispatchEvent(requestEvent);
    });
}

const fnproxy = (object, func) => new Proxy(object, { apply: func });
const proxy = (object, key, func) => Object.hasOwnProperty.call(object, key) && Object.defineProperty(object, key, {
    value: fnproxy(object[key], func)
});

function getEventListeners(type) {
    if (this == null) return [];
    const store = this[Symbol.for(getEventListeners)];
    if (store == null || store[type] == null) return [];
    return store[type];
}

class Evaluator {
    static isDASH(text) {
        return text.includes('<mpd') && text.includes('</mpd>');
    }

    static isHLS(text) {
        return text.includes('#extm3u');
    }

    static isHLSMaster(text) {
        return text.includes('#ext-x-stream-inf');
    }

    static isMSS(text) {
        return text.includes('<smoothstreamingmedia') && text.includes('</smoothstreamingmedia>');
    }

    static getManifestType(text) {
        const lower = text.toLowerCase();
        if (this.isDASH(lower)) {
            return "DASH";
        } else if (this.isHLS(lower)) {
            if (this.isHLSMaster(lower)) {
                return "HLS_MASTER";
            } else {
                return "HLS_PLAYLIST";
            }
        } else if (this.isMSS(lower)) {
            return "MSS";
        }
    }
}

class VideoNameExtractor {
    static extractVideoName() {
        // Try multiple methods to extract video name, ordered by reliability

        // 1. Try JSON-LD structured data
        const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
        if (jsonLdScript) {
            try {
                const data = JSON.parse(jsonLdScript.textContent);
                if (data.name) return this.sanitizeName(data.name);
                if (data.headline) return this.sanitizeName(data.headline);
                if (data['@type'] === 'VideoObject' && data.name) return this.sanitizeName(data.name);
            } catch (e) {}
        }

        // 2. Try Open Graph meta tags
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.content) {
            return this.sanitizeName(ogTitle.content);
        }

        // 3. Try Twitter meta tags
        const twitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (twitterTitle && twitterTitle.content) {
            return this.sanitizeName(twitterTitle.content);
        }

        // 4. Try common video player attributes
        const videoElement = document.querySelector('video[title], video[data-title], video[aria-label]');
        if (videoElement) {
            const title = videoElement.getAttribute('title') ||
                         videoElement.getAttribute('data-title') ||
                         videoElement.getAttribute('aria-label');
            if (title) return this.sanitizeName(title);
        }

        // 5. Try common video title selectors
        const titleSelectors = [
            'h1.video-title',
            '.video-title',
            '[data-video-title]',
            'h1[class*="title"]',
            '.player-title',
            '[class*="video-name"]',
            'h1',
        ];

        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return this.sanitizeName(element.textContent.trim());
            }
        }

        // 6. Fallback to page title
        if (document.title) {
            return this.sanitizeName(document.title);
        }

        // 7. Last resort - use hostname and timestamp
        return `Video_${window.location.hostname}_${Date.now()}`;
    }

    static sanitizeName(name) {
        // Remove common site suffixes and clean up the name
        let cleaned = name
            .replace(/\s*[-|–—]\s*.+$/, '') // Remove everything after - | – —
            .replace(/\s*\(.+?\)\s*/g, '') // Remove parentheses content
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
            .trim();

        // Limit length
        if (cleaned.length > 100) {
            cleaned = cleaned.substring(0, 100);
        }

        return cleaned || 'Untitled_Video';
    }
}

(async () => {
    if (typeof EventTarget !== 'undefined') {
        proxy(EventTarget.prototype, 'addEventListener', async (_target, _this, _args) => {
            if (_this != null) {
                const [type, listener] = _args;

                const storeKey = Symbol.for(getEventListeners);
                if (!(storeKey in _this)) _this[storeKey] = {};

                const store = _this[storeKey];
                if (!(type in store)) store[type] = [];
                const listeners = store[type];

                let wrappedListener = listener;
                if (type === "message" && !!listener && !listener._isWrapped && (typeof MediaKeyMessageEvent !== 'undefined')) {
                    wrappedListener = async function(event) {
                        if (event instanceof MediaKeyMessageEvent) {
                            if (event._isCustomEvent) {
                                if (listener.handleEvent) {
                                    listener.handleEvent(event);
                                } else {
                                    listener.call(this, event);
                                }
                                return;
                            }

                            let newBody = new Uint8Array(event.message);
                            if (!compareUint8Arrays(new Uint8Array([0x08, 0x04]), new Uint8Array(event.message))) {
                                console.log("[WidevineProxy2]", "WIDEVINE_PROXY", "MESSAGE", listener);
                                if (listener.name !== "messageHandler") {
                                    const oldChallenge = uint8ArrayToBase64(new Uint8Array(event.message));
                                    const videoName = VideoNameExtractor.extractVideoName();
                                    const newChallenge = await emitAndWaitForResponse("REQUEST", oldChallenge, videoName);
                                    if (oldChallenge !== newChallenge) {
                                        // Playback will fail if the challenges are the same (aka. the background script
                                        // returned the same challenge because the addon is disabled), but I still
                                        // override the challenge anyway, so check beforehand (in base64 form)
                                        newBody = base64toUint8Array(newChallenge);
                                    }
                                } else {
                                    // trick EME Logger
                                    // better suggestions for avoiding EME Logger interference are welcome
                                    await emitAndWaitForResponse("REQUEST", "");
                                }
                            }

                            const newEvent = new MediaKeyMessageEvent('message', {
                                isTrusted: event.isTrusted,
                                bubbles: event.bubbles,
                                cancelBubble: event.cancelBubble,
                                composed: event.composed,
                                currentTarget: event.currentTarget,
                                defaultPrevented: event.defaultPrevented,
                                eventPhase: event.eventPhase,
                                message: newBody.buffer,
                                messageType: event.messageType,
                                returnValue: event.returnValue,
                                srcElement: event.srcElement,
                                target: event.target,
                                timeStamp: event.timeStamp,
                            });
                            newEvent._isCustomEvent = true;

                            _this.dispatchEvent(newEvent);
                            event.stopImmediatePropagation();
                            return
                        }

                        if (listener.handleEvent) {
                            listener.handleEvent(event);
                        } else {
                            listener.call(this, event);
                        }
                    };

                    wrappedListener._isWrapped = true;
                    wrappedListener.originalListener = listener;
                }

                const alreadyAdded = listeners.some(
                    storedListener => storedListener && storedListener.originalListener === listener
                );

                if (!alreadyAdded) {
                    listeners.push(wrappedListener);
                    _args[1] = wrappedListener;
                }
            }
            return _target.apply(_this, _args);
        });
    }

    if (typeof MediaKeySession !== 'undefined') {
        proxy(MediaKeySession.prototype, 'update', async (_target, _this, _args) => {
            const [response] = _args;
            console.log("[WidevineProxy2]", "WIDEVINE_PROXY", "UPDATE");
            const videoName = VideoNameExtractor.extractVideoName();
            await emitAndWaitForResponse("RESPONSE", uint8ArrayToBase64(new Uint8Array(response)), videoName)
            return await _target.apply(_this, _args);
        });
    }
})();

const originalFetch = window.fetch;
window.fetch = function() {
    return new Promise(async (resolve, reject) => {
        originalFetch.apply(this, arguments).then((response) => {
            if (response) {
                response.clone().text().then((text) => {
                    const manifest_type = Evaluator.getManifestType(text);
                    if (manifest_type) {
                        if (arguments.length === 1) {
                            emitAndWaitForResponse("MANIFEST", JSON.stringify({
                                "url": arguments[0].url,
                                "type": manifest_type,
                            }));
                        } else if (arguments.length === 2) {
                            emitAndWaitForResponse("MANIFEST", JSON.stringify({
                                "url": arguments[0],
                                "type": manifest_type,
                            }));
                        }
                    }
                    resolve(response);
                }).catch(() => {
                    resolve(response);
                })
            } else {
                resolve(response);
            }
        }).catch(() => {
            resolve();
        })
    })
}

const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    return open.apply(this, arguments);
};

const send = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(postData) {
    this.addEventListener('load', async function() {
        if (this._method === "GET") {
            let body = void 0;
            switch (this.responseType) {
                case "":
                case "text":
                    body = this.responseText ?? this.response;
                    break;
                case "json":
                    // TODO: untested
                    body = JSON.stringify(this.response);
                    break;
                case "arraybuffer":
                    // TODO: untested
                    if (this.response.byteLength) {
                        const response = new Uint8Array(this.response);
                        body = uint8ArrayToString(new Uint8Array([...response.slice(0, 2000), ...response.slice(-2000)]));
                    }
                    break;
                case "document":
                    // todo
                    break;
                case "blob":
                    body = await this.response.text();
                    break;
            }
            if (body) {
                const manifest_type = Evaluator.getManifestType(body);
                if (manifest_type) {
                    emitAndWaitForResponse("MANIFEST", JSON.stringify({
                        "url": this.responseURL,
                        "type": manifest_type,
                    }));
                }
            }
        }
    });
    return send.apply(this, arguments);
};

// ================ Batch Video Processing ================
class BatchVideoProcessor {
    constructor() {
        this.isProcessing = false;
        this.currentIndex = 0;
        this.videoQueue = [];
        this.processedVideos = new Set();
    }

    findAllVideos() {
        // Find all video elements on the page
        const videos = Array.from(document.querySelectorAll('video'));

        // Also look for video containers that might load videos dynamically
        const videoContainers = Array.from(document.querySelectorAll(
            '[class*="video"], [class*="player"], [id*="video"], [id*="player"]'
        ));

        // Find videos in iframes (if accessible)
        try {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            for (const iframe of iframes) {
                try {
                    const iframeVideos = Array.from(iframe.contentDocument.querySelectorAll('video'));
                    videos.push(...iframeVideos);
                } catch (e) {
                    // Can't access cross-origin iframe
                }
            }
        } catch (e) {}

        return videos.filter(v => v.src || v.querySelector('source'));
    }

    async start() {
        if (this.isProcessing) {
            console.log("[BatchProcessor] Already processing");
            return;
        }

        this.videoQueue = this.findAllVideos();
        if (this.videoQueue.length === 0) {
            console.log("[BatchProcessor] No videos found on page");
            this.sendProgress(0, 0, "completed", null);
            return;
        }

        console.log("[BatchProcessor] Found", this.videoQueue.length, "videos");
        this.isProcessing = true;
        this.currentIndex = 0;
        this.processedVideos.clear();

        await this.processNextVideo();
    }

    stop() {
        this.isProcessing = false;
        console.log("[BatchProcessor] Stopped");
    }

    async processNextVideo() {
        if (!this.isProcessing || this.currentIndex >= this.videoQueue.length) {
            this.isProcessing = false;
            this.sendProgress(this.currentIndex, this.videoQueue.length, "completed", null);
            console.log("[BatchProcessor] Completed all videos");
            return;
        }

        const video = this.videoQueue[this.currentIndex];
        const videoName = VideoNameExtractor.extractVideoName();

        console.log("[BatchProcessor] Processing video", this.currentIndex + 1, "of", this.videoQueue.length, ":", videoName);
        this.sendProgress(this.currentIndex, this.videoQueue.length, "processing", videoName);

        try {
            // Scroll video into view
            video.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.sleep(500);

            // Play the video to trigger DRM
            if (video.paused) {
                await video.play().catch(e => console.log("[BatchProcessor] Play error:", e));
            }

            // Wait for video to load and potentially trigger DRM
            await this.sleep(3000);

            // Mark as processed
            this.processedVideos.add(video);
            this.currentIndex++;

            // Move to next video
            if (this.isProcessing) {
                setTimeout(() => this.processNextVideo(), 1000);
            }
        } catch (error) {
            console.error("[BatchProcessor] Error processing video:", error);
            this.currentIndex++;
            if (this.isProcessing) {
                setTimeout(() => this.processNextVideo(), 1000);
            }
        }
    }

    sendProgress(processed, total, status, currentVideo) {
        // Send via custom event to ISOLATED world
        document.dispatchEvent(new CustomEvent('batchProgress', {
            detail: {
                processed: processed,
                total: total,
                status: status,
                currentVideo: currentVideo
            }
        }));
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const batchProcessor = new BatchVideoProcessor();

// Listen for batch processing commands from ISOLATED world
document.addEventListener('batchCommand', (event) => {
    const { command } = event.detail;
    if (command === 'start') {
        console.log("[BatchProcessor] Received start command");
        batchProcessor.start();
    } else if (command === 'stop') {
        console.log("[BatchProcessor] Received stop command");
        batchProcessor.stop();
    }
});
// =======================================================
