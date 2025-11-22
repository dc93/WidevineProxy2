import "../protobuf.min.js";
import "../license_protocol.js";
import {AsyncLocalStorage, base64toUint8Array, stringToUint8Array, DeviceManager, RemoteCDMManager, SettingsManager} from "../util.js";

const key_container = document.getElementById('key-container');

// ================ Main ================
const enabled = document.getElementById('enabled');
enabled.addEventListener('change', async function (){
    await SettingsManager.setEnabled(enabled.checked);
});

const toggle = document.getElementById('darkModeToggle');
toggle.addEventListener('change', async () => {
    await SettingsManager.setDarkMode(toggle.checked);
    await SettingsManager.saveDarkMode(toggle.checked);
});

const wvd_select = document.getElementById('wvd_select');
wvd_select.addEventListener('change', async function (){
    if (wvd_select.checked) {
        await SettingsManager.saveSelectedDeviceType("WVD");
    }
});

const remote_select = document.getElementById('remote_select');
remote_select.addEventListener('change', async function (){
    if (remote_select.checked) {
        await SettingsManager.saveSelectedDeviceType("REMOTE");
    }
});

const export_button = document.getElementById('export');
export_button.addEventListener('click', async function() {
    const logs = await AsyncLocalStorage.getStorage(null);
    SettingsManager.downloadFile(stringToUint8Array(JSON.stringify(logs)), "logs.json");
});
// ======================================

// ================ Widevine Device ================
document.getElementById('fileInput').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "OPEN_PICKER_WVD" });
    window.close();
});

const remove = document.getElementById('remove');
remove.addEventListener('click', async function() {
    await DeviceManager.removeSelectedWidevineDevice();
    wvd_combobox.innerHTML = '';
    await DeviceManager.loadSetAllWidevineDevices();
    const selected_option = wvd_combobox.options[wvd_combobox.selectedIndex];
    if (selected_option) {
        await DeviceManager.saveSelectedWidevineDevice(selected_option.text);
    } else {
        await DeviceManager.removeSelectedWidevineDeviceKey();
    }
});

const download = document.getElementById('download');
download.addEventListener('click', async function() {
    const widevine_device = await DeviceManager.getSelectedWidevineDevice();
    SettingsManager.downloadFile(
        base64toUint8Array(await DeviceManager.loadWidevineDevice(widevine_device)),
        widevine_device + ".wvd"
    )
});

const wvd_combobox = document.getElementById('wvd-combobox');
wvd_combobox.addEventListener('change', async function() {
    await DeviceManager.saveSelectedWidevineDevice(wvd_combobox.options[wvd_combobox.selectedIndex].text);
});
// =================================================

// ================ Remote CDM ================
document.getElementById('remoteInput').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "OPEN_PICKER_REMOTE" });
    window.close();
});

const remote_remove = document.getElementById('remoteRemove');
remote_remove.addEventListener('click', async function() {
    await RemoteCDMManager.removeSelectedRemoteCDM();
    remote_combobox.innerHTML = '';
    await RemoteCDMManager.loadSetAllRemoteCDMs();
    const selected_option = remote_combobox.options[remote_combobox.selectedIndex];
    if (selected_option) {
        await RemoteCDMManager.saveSelectedRemoteCDM(selected_option.text);
    } else {
        await RemoteCDMManager.removeSelectedRemoteCDMKey();
    }
});

const remote_download = document.getElementById('remoteDownload');
remote_download.addEventListener('click', async function() {
    const remote_cdm = await RemoteCDMManager.getSelectedRemoteCDM();
    SettingsManager.downloadFile(
        await RemoteCDMManager.loadRemoteCDM(remote_cdm),
        remote_cdm + ".json"
    )
});

const remote_combobox = document.getElementById('remote-combobox');
remote_combobox.addEventListener('change', async function() {
    await RemoteCDMManager.saveSelectedRemoteCDM(remote_combobox.options[remote_combobox.selectedIndex].text);
});
// ============================================

// ================ Command Options ================
const use_shaka = document.getElementById('use-shaka');
use_shaka.addEventListener('change', async function (){
    await SettingsManager.saveUseShakaPackager(use_shaka.checked);
});

const downloader_name = document.getElementById('downloader-name');
downloader_name.addEventListener('input', async function (event){
    console.log("input change", event);
    await SettingsManager.saveExecutableName(downloader_name.value);
});
// =================================================

// ================ Batch Processing ================
const start_batch = document.getElementById('start-batch');
const stop_batch = document.getElementById('stop-batch');
const batch_status_text = document.getElementById('batch-status-text');
const batch_progress = document.getElementById('batch-progress');

start_batch.addEventListener('click', async function() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: "START_BATCH_PROCESSING" });
        start_batch.disabled = true;
        stop_batch.disabled = false;
        batch_status_text.textContent = "Status: Running...";
    }
});

stop_batch.addEventListener('click', async function() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: "STOP_BATCH_PROCESSING" });
        start_batch.disabled = false;
        stop_batch.disabled = true;
        batch_status_text.textContent = "Status: Stopped";
    }
});

// Listen for batch processing updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "BATCH_PROGRESS") {
        batch_progress.textContent = `Videos: ${message.processed} / ${message.total}`;
        if (message.status === "completed") {
            batch_status_text.textContent = "Status: Completed";
            start_batch.disabled = false;
            stop_batch.disabled = true;
        } else if (message.status === "processing") {
            const shortName = message.currentVideo.length > 35
                ? message.currentVideo.substring(0, 35) + '...'
                : message.currentVideo;
            batch_status_text.textContent = `Processing: ${shortName}`;
        }
    }
});
// =================================================

// ================ Keys ================
const clear = document.getElementById('clear');
clear.addEventListener('click', async function() {
    chrome.runtime.sendMessage({ type: "CLEAR" });
    key_container.innerHTML = "";
});

const copy_all_commands = document.getElementById('copy-all-commands');
copy_all_commands.addEventListener('click', async function() {
    const logs = await AsyncLocalStorage.getStorage(null);
    const commands = [];

    for (const [key, result] of Object.entries(logs)) {
        if (result.keys && result.manifests && result.manifests.length > 0) {
            const key_string = result.keys.map(key => `--key ${key.kid}:${key.k}`).join(' ');
            const videoName = result.videoName || 'Unknown Video';

            // Get first manifest
            const manifestJson = JSON.stringify(result.manifests[0]);
            const command = await createCommand(manifestJson, key_string, videoName);

            commands.push(`# ${videoName}`);
            commands.push(command);
            commands.push(''); // Empty line for readability
        }
    }

    if (commands.length > 0) {
        const allCommands = commands.join('\n');
        await navigator.clipboard.writeText(allCommands);
        console.log(`[WidevineProxy2] Copied ${commands.length / 3} commands to clipboard`);
    } else {
        console.log('[WidevineProxy2] No commands to copy');
    }
});

async function createCommand(json, key_string, videoName) {
    const metadata = JSON.parse(json);
    const header_string = Object.entries(metadata.headers).map(([key, value]) => `-H "${key}: ${value.replace(/"/g, "'")}"`).join(' ');

    // Create safe filename from video name
    const safeVideoName = videoName && videoName !== 'Unknown Video'
        ? videoName.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_')
        : 'output';

    return `${await SettingsManager.getExecutableName()} "${metadata.url}" ${header_string} ${key_string} ${await SettingsManager.getUseShakaPackager() ? "--use-shaka-packager " : ""}--save-name "${safeVideoName}" -M format=mkv`;
}

async function appendLog(result) {
    const key_string = result.keys.map(key => `--key ${key.kid}:${key.k}`).join(' ');
    const date = new Date(result.timestamp * 1000);
    const date_string = date.toLocaleString();
    const videoName = result.videoName || 'Unknown Video';

    const logContainer = document.createElement('div');
    logContainer.classList.add('log-container');
    logContainer.innerHTML = `
        <button class="toggleButton">+</button>
        <div class="expandableDiv collapsed">
            <label class="always-visible right-bound">
                Video Name:<input type="text" class="text-box" value="${videoName}">
            </label>
            <label class="expanded-only right-bound">
                URL:<input type="text" class="text-box" value="${result.url}">
            </label>
            <label class="expanded-only right-bound">
                PSSH:<input type="text" class="text-box" value="${result.pssh_data}">
            </label>
            <label class="expanded-only right-bound key-copy">
                <a href="#" title="Click to copy">Keys:</a><input type="text" class="text-box" value="${key_string}">
            </label>
            <label class="expanded-only right-bound">
                Date:<input type="text" class="text-box" value="${date_string}">
            </label>
            ${result.manifests.length > 0 ? `<label class="expanded-only right-bound manifest-copy">
                <a href="#" title="Click to copy">Manifest:</a><select id="manifest" class="text-box"></select>
            </label>
            <label class="expanded-only right-bound command-copy">
                <a href="#" title="Click to copy">Cmd:</a><input type="text" id="command" class="text-box">
            </label>` : ''}
        </div>`;

    const keysInput = logContainer.querySelector('.key-copy');
    keysInput.addEventListener('click', () => {
        navigator.clipboard.writeText(key_string);
    });

    if (result.manifests.length > 0) {
        const command = logContainer.querySelector('#command');

        const select = logContainer.querySelector("#manifest");
        select.addEventListener('change', async () => {
            command.value = await createCommand(select.value, key_string, videoName);
        });
        result.manifests.forEach((manifest) => {
            const option = new Option(`[${manifest.type}] ${manifest.url}`, JSON.stringify(manifest));
            select.add(option);
        });
        command.value = await createCommand(select.value, key_string, videoName);

        const manifest_copy = logContainer.querySelector('.manifest-copy');
        manifest_copy.addEventListener('click', () => {
            navigator.clipboard.writeText(JSON.parse(select.value).url);
        });

        const command_copy = logContainer.querySelector('.command-copy');
        command_copy.addEventListener('click', () => {
            navigator.clipboard.writeText(command.value);
        });
    }

    const toggleButtons = logContainer.querySelector('.toggleButton');
    toggleButtons.addEventListener('click', function () {
        const expandableDiv = this.nextElementSibling;
        if (expandableDiv.classList.contains('collapsed')) {
            toggleButtons.innerHTML = "-";
            expandableDiv.classList.remove('collapsed');
            expandableDiv.classList.add('expanded');
        } else {
            toggleButtons.innerHTML = "+";
            expandableDiv.classList.remove('expanded');
            expandableDiv.classList.add('collapsed');
        }
    });

    key_container.appendChild(logContainer);
}

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
        for (const [key, values] of Object.entries(changes)) {
            await appendLog(values.newValue);
        }
    }
});

function checkLogs() {
    chrome.runtime.sendMessage({ type: "GET_LOGS" }, (response) => {
        if (response) {
            response.forEach(async (result) => {
                await appendLog(result);
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', async function () {
    enabled.checked = await SettingsManager.getEnabled();
    SettingsManager.setDarkMode(await SettingsManager.getDarkMode());
    use_shaka.checked = await SettingsManager.getUseShakaPackager();
    downloader_name.value = await SettingsManager.getExecutableName();
    await SettingsManager.setSelectedDeviceType(await SettingsManager.getSelectedDeviceType());
    await DeviceManager.loadSetAllWidevineDevices();
    await DeviceManager.selectWidevineDevice(await DeviceManager.getSelectedWidevineDevice());
    await RemoteCDMManager.loadSetAllRemoteCDMs();
    await RemoteCDMManager.selectRemoteCDM(await RemoteCDMManager.getSelectedRemoteCDM());
    checkLogs();
});
// ======================================
