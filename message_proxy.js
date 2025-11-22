async function processMessage(detail) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: detail.type,
            body: detail.body,
            videoName: detail.videoName,
        }, (response) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            resolve(response);
        });
    })
}

document.addEventListener('response', async (event) => {
    const { detail } = event;
    const responseData = await processMessage(detail);
    const responseEvent = new CustomEvent('responseReceived', {
        detail: detail.requestId.concat(responseData)
    });
    document.dispatchEvent(responseEvent);
});

// Listen for batch processing commands from panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "START_BATCH_PROCESSING") {
        // Forward to MAIN world
        document.dispatchEvent(new CustomEvent('batchCommand', {
            detail: { command: 'start' }
        }));
        sendResponse({ success: true });
    } else if (message.type === "STOP_BATCH_PROCESSING") {
        // Forward to MAIN world
        document.dispatchEvent(new CustomEvent('batchCommand', {
            detail: { command: 'stop' }
        }));
        sendResponse({ success: true });
    }
    return true;
});

// Listen for batch progress updates from MAIN world and forward to background
document.addEventListener('batchProgress', (event) => {
    const { detail } = event;
    chrome.runtime.sendMessage({
        type: "BATCH_PROGRESS",
        processed: detail.processed,
        total: detail.total,
        status: detail.status,
        currentVideo: detail.currentVideo
    });
});
