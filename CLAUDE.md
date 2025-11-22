# CLAUDE.md - AI Assistant Guide for WidevineProxy2

## Project Overview

**WidevineProxy2** is a Manifest V3 browser extension that intercepts Widevine EME (Encrypted Media Extensions) challenges and license messages to extract decryption keys from DRM-protected content. It supports both local Widevine Device (.wvd) files and remote CDM APIs.

**Educational Purpose Only**: This tool is designed for authorized security research, DRM analysis, and educational contexts only. Do not use for piracy or unauthorized content access.

**Language**: Pure vanilla JavaScript (ES6 modules), no build system or transpilation
**Size**: ~13,450 lines of custom code (excluding minified libraries)
**License**: GPL v3

## Repository Structure

```
WidevineProxy2/
├── manifest.json                 # Extension manifest (Manifest V3)
│
├── Background Service Worker
│   └── background.js             # Main background script, message router
│
├── Content Scripts
│   ├── content_script.js         # MAIN world: intercepts EME events
│   └── message_proxy.js          # ISOLATED world: message bridge
│
├── Core Widevine Implementation
│   ├── license.js                # Session management, license parsing
│   ├── device.js                 # .wvd file parser
│   ├── remote_cdm.js             # Remote CDM API client
│   ├── cmac.js                   # AES-CMAC crypto implementation
│   └── license_protocol.js       # Widevine protobuf schema (~665KB)
│
├── Utilities & Storage
│   └── util.js                   # Storage managers, converters
│
├── UI Components
│   ├── panel/
│   │   ├── panel.html           # Popup interface
│   │   ├── panel.js             # Popup controller
│   │   └── panel.css            # Popup styles
│   └── picker/                  # File picker dialogs
│       ├── wvd/                 # Widevine Device picker
│       └── remote/              # Remote CDM picker
│
├── Third-Party Libraries
│   ├── forge.min.js             # Crypto library (282KB)
│   └── protobuf.min.js          # Protobuf.js (21KB)
│
└── Assets
    └── images/                   # Extension icons
```

## Key Components & Responsibilities

### 1. background.js (~353 lines)
**Role**: Background service worker and central message router

**Key Responsibilities**:
- Routes messages between content scripts and popup UI
- Processes Widevine challenges (local or remote mode)
- Extracts and stores decryption keys
- Manages sessions, manifests, and request headers
- Persists logs to chrome.storage.local

**Key Functions**:
- `generateChallenge()` - Creates modified challenge using local .wvd device
- `parseLicense()` - Extracts keys from license response (local mode)
- `generateChallengeRemote()` - Forwards challenge to remote CDM API
- `parseLicenseRemote()` - Retrieves keys from remote CDM
- `parseClearKey()` - Handles unencrypted ClearKey licenses

**Important State**:
```javascript
manifests: Map<tab_url, manifest_array>    // Manifest URLs by tab
requests: Map<url, headers_object>          // Captured request headers
sessions: Map<request_id, Session>          // Active Widevine sessions
logs: Array<log_objects>                    // In-memory key logs
```

### 2. content_script.js (~267 lines)
**Role**: Injected into MAIN world (has access to page JavaScript)

**Key Responsibilities**:
- Intercepts `MediaKeyMessageEvent` (Widevine challenges)
- Proxies challenges to background for modification
- Intercepts `MediaKeySession.update()` (license responses)
- Monitors fetch/XMLHttpRequest for manifest files (DASH/HLS/MSS)
- Communicates via custom DOM events to message_proxy.js

**Key Techniques**:
- Wraps `EventTarget.addEventListener` to intercept message listeners
- Uses `stopImmediatePropagation()` to suppress original events
- Creates new MediaKeyMessageEvent with modified challenge
- Detects and works around EME Logger interference

### 3. message_proxy.js (~23 lines)
**Role**: Bridge between MAIN and ISOLATED worlds

**Why Needed**: Content scripts in MAIN world cannot use `chrome.runtime.sendMessage` directly. This script runs in ISOLATED world to bridge communication.

**Flow**: content_script.js → CustomEvent → message_proxy.js → chrome.runtime → background.js

### 4. license.js (~386 lines)
**Role**: Core Widevine protocol implementation

**Key Class**: `Session`
- `createLicenseRequest(pssh_data)` - Generates signed license request
- `parseLicense(license_bytes)` - Decrypts and extracts content keys
- `setServiceCertificate(cert_bytes)` - Sets privacy certificate
- Static helper: `psshDataToPsshBoxB64(pssh_data)` - Converts PSSH to box format

**Cryptographic Operations**:
- RSA-PSS signature generation (SHA1)
- RSA-OAEP encryption/decryption
- AES-CMAC key derivation
- AES-CBC content key decryption
- HMAC-SHA256 license verification

### 5. device.js (~71 lines)
**Role**: Widevine Device (.wvd) file parser

**Binary Format**:
```
[version: u32][type: u32][sec_level: u32][flags: u32]
[priv_key_len: u32][priv_key: bytes]
[client_id_len: u32][client_id: bytes]
```

**Output**: `WidevineDevice` object with private_key, client_id, type, security_level

### 6. remote_cdm.js (~119 lines)
**Role**: HTTP client for remote CDM APIs

**API Flow**:
1. `GET /{device}/open` → session_id
2. `POST /{device}/get_license_challenge/STREAMING` → challenge_b64
3. `POST /{device}/parse_license` (send license)
4. `POST /{device}/get_keys/CONTENT` → array of {key_id, key}
5. `GET /{device}/close/{session}` (cleanup)

**Authentication**: `X-Secret-Key` header with API key

### 7. util.js (~384 lines)
**Role**: Storage management and utility functions

**Key Exports**:
- `AsyncSyncStorage` / `AsyncLocalStorage` - Promise-based chrome.storage wrappers
- `DeviceManager` - Manages .wvd devices in sync storage (~25 max)
- `RemoteCDMManager` - Manages remote.json configs (~200 max)
- `SettingsManager` - Enabled state, dark mode, executable settings
- `base64toUint8Array()`, `uint8ArrayToBase64()`, `uint8ArrayToHex()` - Converters

### 8. panel.js (~242 lines)
**Role**: Popup UI controller

**Key Features**:
- Real-time key display with expandable log containers
- N_m3u8DL-RE command generation
- Export logs functionality
- Device/CDM selection
- Dark mode toggle

**Updates**: Listens to `chrome.storage.onChanged` for real-time UI updates

## Data Flow: Widevine Challenge Processing

### Local .wvd Mode

```
1. Web page plays DRM video
   → MediaKeySession generates message event
   ↓
2. content_script.js intercepts MediaKeyMessageEvent
   → Extracts challenge (Uint8Array → base64)
   → Sends REQUEST message via message_proxy
   ↓
3. background.js receives REQUEST
   → Decodes SignedMessage and LicenseRequest (protobuf)
   → Extracts PSSH from contentId.widevinePsshData
   → Checks if keys already retrieved
   ↓
4. Loads selected .wvd device
   → Creates WidevineDevice instance
   → Extracts private_key and client_id
   ↓
5. Creates Session (license.js)
   → Parses PSSH data
   → Generates new LicenseRequest with device's request_id
   → Signs with RSA-PSS (SHA1, private_key)
   → Returns modified challenge (base64)
   ↓
6. Modified challenge → content_script
   → Dispatches new MediaKeyMessageEvent
   → Original event suppressed
   ↓
7. Modified challenge sent to license server
   → Server processes Android CDM challenge
   → Returns license response
   ↓
8. MediaKeySession.update(license) intercepted
   → content_script sends RESPONSE message
   ↓
9. background.js parseLicense()
   → Verifies signature (HMAC-SHA256)
   → Derives encryption key (AES-CMAC)
   → Decrypts content keys (AES-CBC)
   → Extracts KID:KEY pairs
   ↓
10. Keys saved to chrome.storage.local
    → Indexed by PSSH box (base64)
    → Includes URL, timestamp, manifest
    ↓
11. panel.js displays keys
    → Real-time update via storage listener
```

### Remote CDM Mode

Same as local mode, except steps 4-5 replaced with:
```
4. Loads remote.json config
   → Contains: host, device_name, secret
   ↓
5. Calls Remote CDM API
   → POST /open → session_id
   → POST /get_license_challenge → modified challenge
```

And step 9 replaced with:
```
9. background.js parseLicenseRemote()
   → POST /parse_license (send license)
   → POST /get_keys/CONTENT → [{key_id, key}]
   → POST /close (cleanup)
```

## Storage Schema

### chrome.storage.sync (~102KB total limit, synced across browsers)

```javascript
{
  // Settings
  "enabled": boolean,                    // Extension on/off
  "dark_mode": boolean,                 // UI theme
  "device_type": "WVD" | "REMOTE",      // Selected mode
  "use_shaka": boolean,                 // Command option
  "exe_name": string,                   // Default: "N_m3u8DL-RE"

  // Widevine Devices (~25 max due to size limits)
  "devices": ["device1", "device2"],
  "device1": "base64_encoded_wvd_bytes",
  "selected": "device1",

  // Remote CDMs (~200 max)
  "remote_cdms": ["remote1", "remote2"],
  "remote1": {
    "device_type": "ANDROID",
    "system_id": 18,
    "security_level": 3,
    "host": "https://api.example.com",
    "secret": "api_key",
    "device_name": "device_name"
  },
  "selected_remote_cdm": "remote1"
}
```

### chrome.storage.local (unlimited, persistent key logs)

```javascript
{
  "base64_pssh_box": {
    "type": "WIDEVINE" | "CLEARKEY",
    "pssh_data": "base64_pssh",
    "keys": [
      {"kid": "hex_key_id", "k": "hex_key"}
    ],
    "url": "https://player.example.com",
    "timestamp": 1234567890,
    "manifests": [
      {
        "type": "DASH" | "HLS_MASTER" | "HLS_PLAYLIST" | "MSS",
        "url": "https://manifest.url",
        "headers": {"Header": "value"}
      }
    ]
  }
}
```

## Coding Conventions

### Import/Export Patterns
```javascript
// Always use ES6 modules with explicit imports
import { Session } from "./license.js";
import { base64toUint8Array, uint8ArrayToHex } from "./util.js";

// Export classes and functions
export class DeviceManager { ... }
export function uint8ArrayToBase64(buffer) { ... }
```

### Async/Await Usage
- All chrome.storage operations wrapped in Promises via AsyncSyncStorage/AsyncLocalStorage
- Extensive use of async/await for cleaner asynchronous code
- No callback-based patterns (all modernized)

### Naming Conventions
- **Variables**: snake_case (e.g., `license_request`, `pssh_data`, `signed_message`)
- **Functions**: camelCase (e.g., `generateChallenge`, `parseLicense`)
- **Classes**: PascalCase (e.g., `Session`, `WidevineDevice`, `DeviceManager`)
- **Constants**: Destructured from protobuf roots (e.g., `LicenseType`, `SignedMessage`)

### Error Handling
- Console logging with `[WidevineProxy2]` prefix for debugging
- Silent failures for non-critical operations (e.g., keys already retrieved)
- Explicit checks before operations (e.g., `if (!pssh_data)` early returns)

### Code Organization
- Each file has a single primary purpose
- Classes encapsulate related functionality
- Utilities separated from business logic
- No TypeScript or JSDoc annotations (plain JavaScript)

## Development Workflow

### No Build System
- Pure vanilla JavaScript (ES6 modules)
- No package.json, webpack, or bundler required
- Direct script loading via manifest.json
- Manual minification for third-party libraries

### Local Development

**Chrome**:
1. Navigate to `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the WidevineProxy2 directory
5. Edit files directly - extension auto-reloads on manifest changes

**Firefox**:
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file in the WidevineProxy2 directory
4. Note: Temporary extensions cleared on browser restart

### Testing Changes
1. Make code edits in your editor
2. Click reload button in chrome://extensions or about:debugging
3. Test on a DRM-protected video site
4. Check console logs in background page and content script
5. Inspect popup UI with DevTools

### Common Debugging Points
- **Background script logs**: Right-click extension icon → "Inspect background page"
- **Content script logs**: F12 on video page → Console
- **Storage inspection**: DevTools → Application → Storage → Extension Storage
- **Message flow**: Look for `[WidevineProxy2]` console logs

## Git Workflow

### Current Branch
- **Development branch**: `claude/claude-md-mi9sqqzay85bn1m7-01X8ZXKBaumfhhwAiUdRLFhP`
- Always develop on the designated claude/* branch
- Branch naming format: `claude/<task-id>-<session-id>`

### Commit Conventions
Based on recent commit history:
- Use `+` prefix for new features: `+ Added manifest detection`
- Use descriptive messages: `Fixed RemoteCdm never actually sending the API Key...`
- Use verb forms: `Updated Remote CDM`, `Fix crashing N_m3u8DL-RE`
- Reference issue numbers when applicable

### Common Operations
```bash
# Check status
git status

# Stage and commit
git add <files>
git commit -m "+ Feature description"
# OR
git commit -m "Fixed <specific issue>"

# Push to feature branch
git push -u origin claude/claude-md-mi9sqqzay85bn1m7-01X8ZXKBaumfhhwAiUdRLFhP
```

## Key Technologies

### Cryptography (via forge.min.js)
- **RSA-OAEP**: Public/private key encryption
- **RSA-PSS**: Signature generation (SHA1)
- **AES-CBC**: Content key decryption
- **AES-CMAC**: Key derivation (custom implementation in cmac.js)
- **HMAC-SHA256**: License verification
- **SHA1**: Hashing

### Protocol Buffers (protobuf.js)
- Widevine license protocol schema in license_protocol.js
- Key message types: SignedMessage, LicenseRequest, License, SignedDrmCertificate
- Encoding/decoding via `MessageType.encode(obj)` and `MessageType.decode(bytes)`

### Browser APIs
- **chrome.storage.sync**: Cross-device synced storage (102KB limit)
- **chrome.storage.local**: Unlimited local storage
- **chrome.webRequest**: HTTP header capture
- **chrome.runtime.sendMessage**: Extension messaging
- **chrome.tabs**: Tab management
- **Content scripts**: MAIN world (page access) and ISOLATED world (extension APIs)

## Important Considerations for AI Assistants

### Security & Ethics
1. This is a DRM analysis tool for educational/research purposes
2. Do not add features that enable large-scale piracy
3. Do not remove security warnings or educational disclaimers
4. Respect intellectual property rights in all modifications

### Code Quality
1. **No unnecessary dependencies**: Keep the project dependency-free (vanilla JS)
2. **Maintain compatibility**: Test changes in both Chrome and Firefox
3. **Preserve existing patterns**: Follow established naming and structure conventions
4. **No breaking changes**: Maintain backward compatibility with existing .wvd files and remote.json format
5. **Storage limits**: Be mindful of chrome.storage.sync 102KB limit when adding features

### Common Tasks

**Adding a new feature**:
1. Identify the appropriate file(s) to modify
2. Follow existing patterns for async/await, imports, naming
3. Update manifest.json if new permissions needed
4. Test in both browsers
5. Add console logging for debugging

**Fixing a bug**:
1. Reproduce the issue and check console logs
2. Identify the component (background, content script, license, etc.)
3. Make minimal changes to fix the root cause
4. Test thoroughly with DRM-protected content
5. Ensure no regression in existing functionality

**Modifying storage schema**:
1. Be extremely careful with chrome.storage.sync size limits
2. Provide migration logic for existing data
3. Update both get/set operations consistently
4. Document changes in CLAUDE.md

**Adding new message types**:
1. Add handler in background.js onMessage listener
2. Add sender in content_script.js or panel.js
3. Define clear request/response format
4. Add error handling and logging

### File Dependencies

When modifying files, be aware of dependencies:

```
background.js depends on:
  - protobuf.min.js, license_protocol.js, forge.min.js
  - license.js, device.js, remote_cdm.js, util.js

panel/panel.js depends on:
  - protobuf.min.js, license_protocol.js, util.js

content_script.js: standalone (no imports)
message_proxy.js: standalone (no imports)

license.js depends on:
  - forge.min.js, cmac.js

util.js depends on:
  - device.js, remote_cdm.js
```

## Known Issues & Limitations

1. **DRM playback fails when extension disabled if EME Logger is active**
   - Root cause: EME Logger interference workaround in content_script.js
   - Solutions welcome

2. **Video playback intentionally blocked when interception active**
   - By design: Browser cannot decrypt Android CDM licenses
   - Keys are extracted, but video won't play

3. **Some services may block Android CDM challenges**
   - Requires ChromeCDM or L1 Android CDM
   - Not a bug in the extension

4. **Storage limits**
   - chrome.storage.sync: ~25 .wvd devices OR ~200 remote CDMs (not both)
   - Due to 102KB total limit

## Testing Checklist

When making changes, test:
- [ ] Extension loads without errors in Chrome
- [ ] Extension loads without errors in Firefox
- [ ] File pickers work (.wvd and remote.json)
- [ ] Device selection persists across browser restarts
- [ ] Keys are extracted and displayed in popup
- [ ] Logs are saved to chrome.storage.local
- [ ] Export logs functionality works
- [ ] Dark mode toggle works
- [ ] Manifest detection works for DASH/HLS/MSS
- [ ] N_m3u8DL-RE command generation is correct
- [ ] Both local .wvd and remote CDM modes work
- [ ] Console logs are helpful for debugging

## Resources

### External Documentation
- [Widevine DRM Architecture](https://developers.google.com/widevine)
- [Encrypted Media Extensions (EME) API](https://developer.mozilla.org/en-US/docs/Web/API/Encrypted_Media_Extensions_API)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Content Scripts Execution Worlds](https://developer.chrome.com/docs/extensions/mv3/content_scripts/#isolated_world)

### Related Projects
- [node-widevine](https://github.com/Frooastside/node-widevine) - Widevine implementation for Node.js
- [forge](https://github.com/digitalbazaar/forge) - JavaScript cryptography library
- [protobuf.js](https://github.com/protobufjs/protobuf.js) - Protocol buffers for JavaScript

### Community
- [VideoHelp Forum](https://forum.videohelp.com/forums/48) - Widevine devices and tools
- [Widevine Device Dumping Guide](https://forum.videohelp.com/threads/408031)

---

**Last Updated**: 2025-11-22
**Extension Version**: 0.8.2
**Maintainer**: DevLARLEY
