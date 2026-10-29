// ==UserScript==
// @name         TweetXer
// @namespace    https://github.com/lucahammer/tweetXer/
// @version      0.10.0
// @description  Delete all your Tweets for free.
// @author       Luca,dbort,pReya,Micolithe,STrRedWolf
// @license      NoHarm-draft
// @match        https://x.com/*
// @match        https://mobile.x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @icon         https://www.google.com/s2/favicons?domain=twitter.com
// @grant        none
// @run-at       document-idle
// @downloadURL  https://update.greasyfork.org/scripts/476062/TweetXer.user.js
// @updateURL    https://update.greasyfork.org/scripts/476062/TweetXer.meta.js
// @supportURL   https://github.com/lucahammer/tweetXer/issues
// ==/UserScript==

(function () {
    'use strict'

    // Stop a previous instance if the script gets pasted twice
    if (window.__tweetXer) window.__tweetXer.destroy()

    const BOOKMARK_FEATURES = '{"graphql_timeline_v2_bookmark_timeline":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"rweb_video_timestamps_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_enhance_cards_enabled":false}'
    const DM_CONVO_BODY = 'dm_secret_conversations_enabled=false&krs_registration_enabled=true&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_ext_limited_action_results=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&include_ext_views=true&dm_users=false&include_groups=true&include_inbox_timelines=true&include_ext_media_color=true&supports_reactions=true&supports_edit=true&include_conversation_info=true'

    const REQUEST_TIMEOUT = 15000
    const MAX_RETRIES = 4
    const MAX_LOG_LINES = 200
    const RENDER_INTERVAL = 250

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const timeoutSignal = (ms) => {
        if (AbortSignal.timeout) return AbortSignal.timeout(ms)
        const controller = new AbortController()
        setTimeout(() => controller.abort(), ms)
        return controller.signal
    }

    // Resolves with the element, or null after the timeout
    const waitForElemToExist = (selector, timeout = 10000, root = document) => {
        const elem = root.querySelector(selector)
        if (elem) return Promise.resolve(elem)

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                observer.disconnect()
                resolve(null)
            }, timeout)
            const observer = new MutationObserver(() => {
                const elem = root.querySelector(selector)
                if (elem) {
                    clearTimeout(timer)
                    observer.disconnect()
                    resolve(elem)
                }
            })
            observer.observe(document.body, { subtree: true, childList: true })
        })
    }

    // Parses counts like "1,234 posts", "12.5K posts", "1.2M Posts" or "1.234 Beiträge"
    const parseCount = (text) => {
        // The suffix must not start a word, e.g. "1.234 Beiträge" is not 1.234 billion
        const match = text.replace(/\s+/gu, ' ').match(/(\d[\d.,]*(?: \d{3})*) ?(?:(mil|mio|[kmb])(?!\p{L}))?\.?\D*$/iu)
        if (!match) return null
        const number = match[1]
        const suffix = (match[2] || '').toLowerCase()
        const multiplier = { k: 1e3, mil: 1e3, m: 1e6, mio: 1e6, b: 1e9 }[suffix]
        if (multiplier) {
            // Abbreviated counts are rounded, so round up a bit to avoid skipping too many
            const value = parseFloat(number.replace(/ /g, '').replace(',', '.'))
            return Number.isFinite(value) ? Math.ceil(value * multiplier * 1.01) : null
        }
        const digits = number.replace(/\D/g, '')
        return digits ? parseInt(digits, 10) : null
    }

    const formatNumber = (n) => Math.round(n).toLocaleString('en-US')

    const formatDuration = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) return '–'
        seconds = Math.round(seconds)
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        const s = seconds % 60
        if (h > 0) return `${h}h ${m}m`
        if (m > 0) return `${m}m ${s}s`
        return `${s}s`
    }

    const STYLE = `
        :host { all: initial; }
        .panel {
            --bg: #ffffff; --fg: #0f1419; --muted: #536471; --border: #cfd9de;
            --accent: #1d9bf0; --accent-fg: #ffffff; --danger: #f4212e; --ok: #00ba7c;
            --field: #f7f9f9; --track: #eff3f4;
            position: fixed; top: 12px; right: 12px; z-index: 2147483647;
            width: 380px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
            display: flex; flex-direction: column; box-sizing: border-box;
            background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 16px;
            box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
            font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        @media (prefers-color-scheme: dark) {
            .panel {
                --bg: #15202b; --fg: #e7e9ea; --muted: #8b98a5; --border: #38444d;
                --field: #192734; --track: #253341; --accent-fg: #ffffff;
            }
        }
        @media (max-width: 500px) {
            .panel { top: auto; bottom: 8px; right: 8px; left: 8px; width: auto; max-width: none; max-height: 70vh; }
        }
        * { box-sizing: border-box; }
        header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
        header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        header small { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 4px; }
        .icon { border: 0; background: transparent; color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; font-size: 16px; line-height: 1; }
        .icon:hover { background: var(--track); color: var(--fg); }
        .body { padding: 12px 14px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
        .panel.minimized .body { display: none; }
        .panel.minimized header { border-bottom: 0; }
        .status { margin: 0; color: var(--fg); word-break: break-word; }
        .status.error { color: var(--danger); }
        .status.success { color: var(--ok); }
        .drop {
            display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center;
            padding: 16px; border: 2px dashed var(--border); border-radius: 12px; cursor: pointer; background: var(--field);
        }
        .drop:hover, .drop.over { border-color: var(--accent); }
        .drop strong { color: var(--accent); }
        .drop span { color: var(--muted); font-size: 12px; }
        .drop input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
        .progress { display: flex; flex-direction: column; gap: 6px; }
        .bar { height: 8px; border-radius: 4px; background: var(--track); overflow: hidden; }
        .bar > div { height: 100%; width: 0; background: var(--accent); transition: width .25s linear; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
        .stats div { display: flex; flex-direction: column; }
        .stats b { font-size: 15px; font-variant-numeric: tabular-nums; }
        .stats span { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
        .row { display: flex; gap: 8px; flex-wrap: wrap; }
        button.btn {
            font: inherit; font-weight: 700; cursor: pointer; border-radius: 999px; padding: 7px 14px;
            border: 1px solid var(--border); background: transparent; color: var(--fg);
        }
        button.btn:hover:not(:disabled) { background: var(--track); }
        button.btn:disabled { opacity: .5; cursor: not-allowed; }
        button.btn.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); }
        button.btn.danger { color: var(--danger); border-color: var(--danger); }
        a.btn { font-weight: 700; color: var(--accent); text-decoration: none; }
        a.btn:hover { text-decoration: underline; }
        details { border-top: 1px solid var(--border); padding-top: 10px; }
        summary { cursor: pointer; font-weight: 700; color: var(--muted); }
        .section { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
        .section p { margin: 0; color: var(--muted); font-size: 13px; }
        .section ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
        .section h3 { margin: 0; font-size: 14px; }
        label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
        input[type=number] {
            width: 100px; font: inherit; color: var(--fg); background: var(--field);
            border: 1px solid var(--border); border-radius: 8px; padding: 4px 8px;
        }
        input[type=number]:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
        .log {
            margin: 0; max-height: 140px; overflow-y: auto; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            color: var(--muted); background: var(--field); border-radius: 8px; padding: 8px; white-space: pre-wrap; word-break: break-all;
        }
        .log:empty { display: none; }
        [hidden] { display: none !important; }
    `

    let TweetsXer = {
        version: '0.10.0',
        TweetCount: null,
        tIds: [],
        failedIds: [],
        ratelimitreset: 0,
        skip: 0,
        total: 0,
        dCount: 0,
        failCount: 0,
        deleteURL: '/i/api/graphql/VaenaVgh5q5ih7kvyVjgtg/DeleteTweet',
        unfavURL: '/i/api/graphql/ZYKSe-w7KEslx3JhSIk5LA/UnfavoriteTweet',
        deleteMessageURL: '/i/api/graphql/BJ6DtxA2llfjnRoRjaiIiw/DMMessageDeleteMutation',
        deleteConvoURL: '/i/api/1.1/dm/conversation/CONVERSATION_ID/delete.json',
        bookmarksURL: '/i/api/graphql/L7vvM2UluPgWOW4GDvWyvw/Bookmarks?',
        username: '',
        action: '',
        baseUrl: 'https://x.com',
        authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        ct0: null,
        transaction_id: '',
        running: false,
        stopRequested: false,
        stopReason: '',
        startTime: 0,
        startCount: 0,
        renderTimer: null,
        ui: {},
        tweetCountReady: null,

        async init() {
            this.baseUrl = `https://${window.location.hostname}`
            this.updateTransactionId()
            this.createUI()
            this.ct0 = this.getCookie('ct0')
            if (!this.ct0) {
                this.updateInfo('You do not seem to be logged in. Log into your account and reload the page.', 'error')
                return
            }
            this.username = this.getUsername()
            this.tweetCountReady = this.getTweetCount()
            await this.tweetCountReady
            if (!this.running) {
                this.updateInfo('Select your tweet-headers.js (or like.js / direct-message-headers.js) from your data export to start.')
            }
        },

        destroy() {
            this.stopRequested = true
            clearTimeout(this.renderTimer)
            window.removeEventListener('beforeunload', this.onBeforeUnload)
            this.ui.host?.remove()
            if (window.__tweetXer === this) delete window.__tweetXer
        },

        onBeforeUnload(event) {
            if (TweetsXer.running) {
                event.preventDefault()
                event.returnValue = ''
            }
        },

        getCookie(name) {
            const match = `; ${document.cookie}`.match(`;\\s*${name}=([^;]+)`)
            return match ? match[1] : null
        },

        getUsername() {
            const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')
            const fromLink = link?.getAttribute('href')?.split('/')[1]
            return fromLink || window.location.pathname.split('/')[1] || ''
        },

        updateTransactionId() {
            // random string
            this.transaction_id = [...crypto.getRandomValues(new Uint8Array(95))]
                .map((x, i) => (i = x / 255 * 61 | 0, String.fromCharCode(i + (i > 9 ? i > 35 ? 61 : 55 : 48)))).join``
        },

        // ---------- UI ----------

        createUI() {
            const host = document.createElement('div')
            host.id = 'tweetXer-root'
            document.getElementById(host.id)?.remove()
            const root = host.attachShadow({ mode: 'open' })
            root.innerHTML = `
                <style>${STYLE}</style>
                <div class="panel" role="dialog" aria-label="TweetXer">
                    <header>
                        <h2 id="title">TweetXer<small>v${this.version}</small></h2>
                        <button class="icon" id="minimize" type="button" title="Minimize" aria-label="Minimize">–</button>
                        <button class="icon" id="close" type="button" title="Remove TweetXer" aria-label="Remove TweetXer">✕</button>
                    </header>
                    <div class="body">
                        <p class="status" id="info" role="status" aria-live="polite">Waiting for your profile to load…</p>
                        <label class="drop" id="drop">
                            <input type="file" id="file" accept=".js,.json" multiple />
                            <strong>Choose export file</strong>
                            <span>tweet-headers.js, tweets.js, like.js or direct-message(-group)-headers.js. Drop it here or click.</span>
                        </label>
                        <div class="progress" id="progress" hidden>
                            <div class="bar" role="progressbar" aria-valuemin="0" id="bar"><div id="barFill"></div></div>
                            <div class="stats">
                                <div><b id="statDone">0</b><span>Done</span></div>
                                <div><b id="statFailed">0</b><span>Failed</span></div>
                                <div><b id="statRate">–</b><span>Per min</span></div>
                                <div><b id="statEta">–</b><span>ETA</span></div>
                            </div>
                        </div>
                        <div class="row">
                            <button class="btn danger" id="stop" type="button" hidden>Stop</button>
                            <button class="btn" id="retryFailed" type="button" hidden>Retry failed</button>
                            <button class="btn" id="downloadFailed" type="button" hidden>Download failed IDs</button>
                        </div>
                        <pre class="log" id="log"></pre>
                        <details id="advanced">
                            <summary>Advanced options</summary>
                            <div class="section">
                                <label>Items to skip (set before choosing a file)
                                    <input id="skipCount" type="number" min="0" step="1" placeholder="auto" />
                                </label>
                                <label>Parallel requests (Tweets only)
                                    <input id="concurrency" type="number" min="1" max="10" step="1" value="3" />
                                </label>
                                <label>Delete DMs one by one instead of whole conversations
                                    <input id="dmOneByOne" type="checkbox" />
                                </label>
                                <p>Supported files:</p>
                                <ul>
                                    <li>tweet-headers.js to delete Tweets (10,000 – 20,000 per hour)</li>
                                    <li>direct-message-headers.js and direct-message-group-headers.js to delete DMs (around 800 per 15 minutes)</li>
                                    <li>like.js to delete Likes (500 per 15 minutes; only works for the most recent few thousand)</li>
                                </ul>
                            </div>
                            <div class="section">
                                <h3>Export bookmarks</h3>
                                <p>Bookmarks are not included in the official data export. You can export them here.</p>
                                <div class="row">
                                    <button class="btn" id="exportBookmarks" type="button">Export bookmarks</button>
                                    <a class="btn" id="bookmarksDownload" hidden download="twitter-bookmarks.json">Download bookmarks</a>
                                </div>
                            </div>
                            <div class="section">
                                <h3>No tweet-headers.js?</h3>
                                <p>Deletes the Tweets visible on your profile. Much slower and less reliable: at most about 4,000 Tweets per hour.</p>
                                <div class="row"><button class="btn" id="slowDelete" type="button">Slow delete without file</button></div>
                            </div>
                            <div class="section">
                                <h3>Unfollow everyone</h3>
                                <p>It's time to let go. This will unfollow every account you follow.</p>
                                <div class="row"><button class="btn" id="unfollowEveryone" type="button">Unfollow everyone</button></div>
                            </div>
                        </details>
                    </div>
                </div>
            `
            document.body.appendChild(host)

            const $ = (id) => root.getElementById(id)
            this.ui = {
                host, root,
                panel: root.querySelector('.panel'),
                title: $('title'), info: $('info'), drop: $('drop'), file: $('file'),
                progress: $('progress'), bar: $('bar'), barFill: $('barFill'),
                statDone: $('statDone'), statFailed: $('statFailed'), statRate: $('statRate'), statEta: $('statEta'),
                stop: $('stop'), retryFailed: $('retryFailed'), downloadFailed: $('downloadFailed'), log: $('log'),
                advanced: $('advanced'), skipCount: $('skipCount'), concurrency: $('concurrency'), dmOneByOne: $('dmOneByOne'),
                exportBookmarks: $('exportBookmarks'), bookmarksDownload: $('bookmarksDownload'),
                slowDelete: $('slowDelete'), unfollowEveryone: $('unfollowEveryone'),
                minimize: $('minimize'), close: $('close'),
            }

            const ui = this.ui
            ui.file.addEventListener('change', () => this.processFiles(ui.file.files))
            ui.drop.addEventListener('dragover', (e) => { e.preventDefault(); ui.drop.classList.add('over') })
            ui.drop.addEventListener('dragleave', () => ui.drop.classList.remove('over'))
            ui.drop.addEventListener('drop', (e) => {
                e.preventDefault()
                ui.drop.classList.remove('over')
                this.processFiles(e.dataTransfer.files)
            })
            ui.stop.addEventListener('click', () => this.requestStop())
            ui.retryFailed.addEventListener('click', () => this.retryFailed())
            ui.downloadFailed.addEventListener('click', () => this.downloadFailed())
            ui.exportBookmarks.addEventListener('click', () => this.exportBookmarks())
            ui.slowDelete.addEventListener('click', () => this.slowDelete())
            ui.unfollowEveryone.addEventListener('click', () => this.unfollow())
            ui.minimize.addEventListener('click', () => {
                const minimized = ui.panel.classList.toggle('minimized')
                ui.minimize.textContent = minimized ? '+' : '–'
                ui.minimize.title = minimized ? 'Expand' : 'Minimize'
                ui.minimize.setAttribute('aria-label', ui.minimize.title)
            })
            ui.close.addEventListener('click', () => this.removeTweetXer())
            window.addEventListener('beforeunload', this.onBeforeUnload)
        },

        updateTitle(text) {
            this.ui.title.firstChild.textContent = text
        },

        updateInfo(text, kind = '') {
            this.ui.info.textContent = text
            this.ui.info.className = `status ${kind}`
        },

        log(text) {
            console.log(`[TweetXer] ${text}`)
            const log = this.ui.log
            const time = new Date().toLocaleTimeString()
            log.append(`${time} ${text}\n`)
            while (log.childNodes.length > MAX_LOG_LINES) log.firstChild.remove()
            log.scrollTop = log.scrollHeight
        },

        setBusy(busy) {
            this.running = busy
            const ui = this.ui
            ui.drop.hidden = busy
            ui.file.disabled = busy
            ui.stop.hidden = !busy
            ui.stop.disabled = false
            for (const button of [ui.exportBookmarks, ui.slowDelete, ui.unfollowEveryone, ui.retryFailed]) {
                button.disabled = busy
            }
            if (busy) {
                this.stopRequested = false
                this.stopReason = ''
                ui.retryFailed.hidden = true
                ui.downloadFailed.hidden = true
            }
        },

        requestStop() {
            if (!this.running) return
            this.stopRequested = true
            this.ui.stop.disabled = true
            this.updateInfo('Stopping after the current requests…')
        },

        startProgress(total, done = 0) {
            this.total = total
            this.dCount = done
            this.failCount = 0
            this.failedIds = []
            this.startTime = Date.now()
            this.startCount = done
            this.ui.progress.hidden = false
            this.ui.bar.setAttribute('aria-valuemax', String(total))
            this.renderProgress()
        },

        // Throttled so that thousands of requests don't cause thousands of DOM updates
        updateProgressBar() {
            if (this.renderTimer) return
            this.renderTimer = setTimeout(() => {
                this.renderTimer = null
                this.renderProgress()
            }, RENDER_INTERVAL)
        },

        renderProgress() {
            const ui = this.ui
            const processed = this.dCount + this.failCount
            const percent = this.total > 0 ? Math.min(100, (processed / this.total) * 100) : 0
            ui.barFill.style.width = `${percent}%`
            ui.bar.setAttribute('aria-valuenow', String(processed))
            ui.statDone.textContent = formatNumber(this.dCount)
            ui.statFailed.textContent = formatNumber(this.failCount)

            const elapsed = (Date.now() - this.startTime) / 1000
            const sessionCount = processed - this.startCount
            const rate = elapsed > 2 && sessionCount > 0 ? sessionCount / elapsed : 0
            ui.statRate.textContent = rate > 0 ? formatNumber(rate * 60) : '–'
            ui.statEta.textContent = rate > 0 ? formatDuration((this.total - processed) / rate) : '–'

            if (this.running && Date.now() >= this.ratelimitreset && !this.stopRequested) {
                this.updateInfo(`${formatNumber(this.dCount)} of ${formatNumber(this.total)} done (${percent.toFixed(1)}%).`)
            }
        },

        finish(message, kind = 'success') {
            clearTimeout(this.renderTimer)
            this.renderTimer = null
            this.setBusy(false)
            this.renderProgress()
            this.updateInfo(message, kind)
            this.log(message)
            if (this.failedIds.length > 0) {
                this.ui.retryFailed.hidden = false
                this.ui.downloadFailed.hidden = false
            }
            this.ui.file.value = ''
        },

        getSkipValue() {
            const value = this.ui.skipCount.value.trim()
            if (value === '') return null
            const n = parseInt(value, 10)
            return Number.isFinite(n) && n >= 0 ? n : 0
        },

        getConcurrency() {
            const n = parseInt(this.ui.concurrency.value, 10)
            return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1
        },

        downloadJSON(data, filename) {
            const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 10000)
        },

        downloadFailed() {
            this.downloadJSON(this.failedIds, `tweetxer-failed-${this.action || 'ids'}.json`)
        },

        // ---------- File handling ----------

        readFile(file) {
            return new Promise((resolve, reject) => {
                const fr = new FileReader()
                fr.onload = () => resolve(fr.result)
                fr.onerror = () => reject(fr.error)
                fr.readAsText(file)
            })
        },

        // Returns { action, ids } for one data export file
        parseExportFile(text) {
            // window.YTD.tweet_headers.part0 = [...]
            const cutpoint = text.indexOf('=')
            if (cutpoint < 0) throw new Error('not a data export file')
            const filestart = text.slice(0, cutpoint)
            const json = JSON.parse(text.slice(cutpoint + 1).trim().replace(/;$/, ''))
            if (!Array.isArray(json)) throw new Error('unexpected file content')

            if (filestart.includes('.tweet_headers.')) {
                return { action: 'untweet', ids: json.map((x) => x.tweet?.tweet_id) }
            }
            if (filestart.includes('.tweets.') || filestart.includes('.tweet.')) {
                return { action: 'untweet', ids: json.map((x) => x.tweet?.id_str) }
            }
            if (filestart.includes('.like.')) {
                return { action: 'unfav', ids: json.map((x) => x.like?.tweetId) }
            }
            if (/\.direct_message(_group)?(_headers|s)\./.test(filestart)) {
                if (this.ui.dmOneByOne.checked) {
                    return {
                        action: 'undm',
                        ids: json.flatMap((c) => (c.dmConversation?.messages || []).map((m) => m.messageCreate?.id)),
                    }
                }
                return { action: 'unconvo', ids: json.map((c) => c.dmConversation?.conversationId) }
            }
            throw new Error('file content not recognized')
        },

        async processFiles(fileList) {
            if (this.running || !fileList || fileList.length === 0) return
            const files = [...fileList]

            let action = ''
            const ids = []
            try {
                this.updateInfo(`Reading ${files.length > 1 ? `${files.length} files` : files[0].name}…`)
                for (const file of files) {
                    const parsed = this.parseExportFile(await this.readFile(file))
                    if (action && action !== parsed.action) throw new Error('please select files of the same type only')
                    action = parsed.action
                    ids.push(...parsed.ids)
                }
            } catch (error) {
                this.ui.file.value = ''
                this.updateInfo(`Could not read the file: ${error.message}. Please use a file from the Twitter/X data export.`, 'error')
                this.updateTitle('TweetXer')
                return
            }

            // Remove empty and duplicate IDs
            this.tIds = [...new Set(ids.filter(Boolean).map(String))]
            this.action = action
            await this.start()
        },

        async start() {
            const action = this.action
            const labels = { untweet: 'Tweets', unfav: 'Likes', undm: 'DMs', unconvo: 'DM conversations' }
            const label = labels[action]
            const total = this.tIds.length
            if (total === 0) {
                this.updateInfo(`The file does not contain any ${label}.`, 'error')
                return
            }

            let skip = this.getSkipValue()
            if (action === 'untweet') {
                // The export lists the newest Tweets first. Delete the oldest first.
                this.tIds.reverse()
                if (skip === null) {
                    // If there is no amount set to skip, automatically try to skip the amount
                    // that has been deleted already: difference of Tweets in file to count on profile.
                    // 5% tolerance to prevent skipping too much.
                    await this.tweetCountReady
                    skip = this.TweetCount === null ? 0 : Math.max(0, total - this.TweetCount - Math.floor(total / 20))
                }
            }
            skip = Math.min(skip || 0, total)
            if (skip > 0) this.log(`Skipping ${formatNumber(skip)} ${label} that were probably deleted already. Use the advanced options to set how many to skip (0 disables the automatic calculation).`)

            this.setBusy(true)
            this.updateTitle(`Deleting ${formatNumber(total)} ${label}`)
            this.startProgress(total, skip)

            const queue = this.tIds.slice(skip)
            const handlers = {
                untweet: (id) => this.deleteTweet(id),
                unfav: (id) => this.deleteFav(id),
                undm: (id) => this.deleteDM(id),
                unconvo: (id) => this.deleteConvo(id),
            }
            // Likes and DMs have strict rate limits; parallel requests only cause more 429s
            const concurrency = action === 'untweet' ? this.getConcurrency() : 1
            await this.runQueue(queue, handlers[action], concurrency)
            this.finishRun(label)
        },

        finishRun(label) {
            if (this.stopRequested) {
                const resume = `${formatNumber(this.dCount)} ${label} done. To resume later, enter ${this.dCount} under "Items to skip".`
                this.finish(this.stopReason ? `${this.stopReason} ${resume}` : `Stopped. ${resume}`, this.stopReason ? 'error' : '')
            } else if (this.failCount > 0) {
                this.finish(`Finished with ${formatNumber(this.failCount)} ${this.failCount === 1 ? 'failure' : 'failures'}. ${formatNumber(this.dCount)} ${label} done.`, 'error')
            } else {
                this.finish(`Finished. ${formatNumber(this.dCount)} ${label} done. Reload the page to confirm.`)
            }
            this.updateTitle('TweetXer')
        },

        async retryFailed() {
            if (this.running || this.failedIds.length === 0) return
            this.tIds = this.action === 'untweet' ? [...this.failedIds].reverse() : [...this.failedIds]
            const skipValue = this.ui.skipCount.value
            this.ui.skipCount.value = '0'
            try {
                await this.start()
            } finally {
                this.ui.skipCount.value = skipValue
            }
        },

        async runQueue(queue, handler, concurrency) {
            let next = 0
            const worker = async () => {
                while (!this.stopRequested && next < queue.length) {
                    const id = queue[next++]
                    const ok = await handler(id)
                    if (ok) {
                        this.dCount++
                    } else if (!this.stopRequested) {
                        // Requests interrupted by stop are not real failures
                        this.failCount++
                        this.failedIds.push(id)
                    }
                    this.updateProgressBar()
                }
            }
            await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
        },

        // ---------- Requests ----------

        headers(contentType = 'application/json') {
            return {
                'authorization': this.authorization,
                'content-type': contentType,
                'x-client-transaction-id': this.transaction_id,
                'x-csrf-token': this.ct0,
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session',
            }
        },

        // Waits while a rate limit is active, shared by all parallel workers
        async waitForRateLimit() {
            while (!this.stopRequested && Date.now() < this.ratelimitreset) {
                const seconds = Math.ceil((this.ratelimitreset - Date.now()) / 1000)
                this.updateInfo(`Rate limited. Waiting ${formatDuration(seconds)}… ${formatNumber(this.dCount)} done so far.`)
                await sleep(Math.min(1000, this.ratelimitreset - Date.now()))
            }
        },

        setRateLimit(response, fallbackSeconds) {
            const reset = parseInt(response.headers.get('x-rate-limit-reset'), 10)
            const until = Number.isFinite(reset) && reset * 1000 > Date.now()
                ? reset * 1000 + 1000
                : Date.now() + fallbackSeconds * 1000
            if (until > this.ratelimitreset) {
                this.ratelimitreset = until
                this.log(`Rate limit hit. Pausing until ${new Date(until).toLocaleTimeString()}.`)
            }
        },

        // Sends a request with retries. Resolves true on success, false on a permanent failure.
        async sendRequest(url, { body, method = 'POST', contentType, referrer, okStatus = (s) => s >= 200 && s < 300 } = {}) {
            let attempt = 0
            let rateLimited = 0
            while (!this.stopRequested) {
                await this.waitForRateLimit()
                if (this.stopRequested) return false
                let response
                try {
                    response = await fetch(url, {
                        headers: this.headers(contentType),
                        referrer: referrer || `${this.baseUrl}/${this.username}/with_replies`,
                        referrerPolicy: 'strict-origin-when-cross-origin',
                        body,
                        method,
                        mode: 'cors',
                        credentials: 'include',
                        signal: timeoutSignal(REQUEST_TIMEOUT),
                    })
                } catch (error) {
                    // Timeouts and network errors
                    attempt++
                    if (attempt > MAX_RETRIES) {
                        this.log(`Giving up on ${url.split('/').pop()}: ${error.name}.`)
                        return false
                    }
                    const wait = 2 ** attempt * 1000
                    this.log(`${error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Request timed out' : 'Network error'}. Retrying in ${wait / 1000}s.`)
                    await sleep(wait)
                    continue
                }

                if (okStatus(response.status)) {
                    const remaining = response.headers.get('x-rate-limit-remaining')
                    if (remaining !== null && parseInt(remaining, 10) < 1) this.setRateLimit(response, 60)
                    return true
                }

                if (response.status === 429 || response.status === 420) {
                    // Exponential backoff when X doesn't tell us when the limit resets
                    rateLimited++
                    this.setRateLimit(response, Math.min(300, 5 * 2 ** rateLimited))
                    continue
                }

                if (response.status >= 500) {
                    attempt++
                    if (attempt <= MAX_RETRIES) {
                        await sleep(2 ** attempt * 1000)
                        continue
                    }
                }

                if (response.status === 401) {
                    // Expired session. Don't fail thousands of requests one by one.
                    this.stopRequested = true
                    this.stopReason = 'Your session expired (status 401). Reload the page, log in again and resume.'
                    this.log(this.stopReason)
                    return false
                }

                this.log(`Request failed with status ${response.status}.`)
                return false
            }
            return false
        },

        deleteTweet(id) {
            return this.sendRequest(this.baseUrl + this.deleteURL, {
                body: JSON.stringify({ variables: { tweet_id: id, dark_request: false }, queryId: this.deleteURL.split('/')[4] }),
            })
        },

        deleteFav(id) {
            return this.sendRequest(this.baseUrl + this.unfavURL, {
                body: JSON.stringify({ variables: { tweet_id: id }, queryId: this.unfavURL.split('/')[4] }),
                referrer: `${this.baseUrl}/${this.username}/likes`,
            })
        },

        deleteDM(id) {
            return this.sendRequest(this.baseUrl + this.deleteMessageURL, {
                body: JSON.stringify({
                    variables: { messageId: id },
                    requestId: crypto.randomUUID ? crypto.randomUUID() : '',
                    queryId: this.deleteMessageURL.split('/')[4],
                }),
                referrer: `${this.baseUrl}/messages`,
            })
        },

        deleteConvo(id) {
            return this.sendRequest(this.baseUrl + this.deleteConvoURL.replace('CONVERSATION_ID', encodeURIComponent(id)), {
                body: DM_CONVO_BODY,
                contentType: 'application/x-www-form-urlencoded',
                referrer: `${this.baseUrl}/messages`,
            })
        },

        // ---------- Bookmarks ----------

        async exportBookmarks() {
            if (this.running) return
            this.setBusy(true)
            this.updateTitle('Exporting bookmarks')
            this.ui.bookmarksDownload.hidden = true

            const bookmarks = []
            const seen = new Set()
            let cursor = ''
            let failures = 0

            while (!this.stopRequested) {
                await this.waitForRateLimit()
                const variables = { count: 100, includePromotedContent: false }
                if (cursor) variables.cursor = cursor

                let response
                try {
                    response = await fetch(this.baseUrl + this.bookmarksURL + new URLSearchParams({
                        variables: JSON.stringify(variables),
                        features: BOOKMARK_FEATURES,
                    }), {
                        headers: this.headers(),
                        referrer: `${this.baseUrl}/i/bookmarks`,
                        referrerPolicy: 'strict-origin-when-cross-origin',
                        method: 'GET',
                        mode: 'cors',
                        credentials: 'include',
                        signal: timeoutSignal(REQUEST_TIMEOUT),
                    })
                } catch (error) {
                    response = null
                }

                if (!response || response.status !== 200) {
                    if (response && (response.status === 429 || response.status === 420)) {
                        this.setRateLimit(response, 60)
                        continue
                    }
                    if (++failures > MAX_RETRIES) {
                        this.log(`Bookmark export stopped after repeated errors${response ? ` (status ${response.status})` : ''}.`)
                        break
                    }
                    await sleep(2 ** failures * 1000)
                    continue
                }
                failures = 0

                let data
                try {
                    data = await response.json()
                } catch (error) {
                    this.log('Received an invalid response while exporting bookmarks.')
                    break
                }
                const instructions = data?.data?.bookmark_timeline_v2?.timeline?.instructions || []
                const entries = instructions.flatMap((i) => i.entries || [])

                let added = 0
                let nextCursor = ''
                for (const item of entries) {
                    if (item.entryId.startsWith('tweet-')) {
                        const tweet = item.content?.itemContent?.tweet_results?.result
                        if (tweet && !seen.has(item.entryId)) {
                            seen.add(item.entryId)
                            bookmarks.push(tweet)
                            added++
                        }
                    } else if (item.entryId.startsWith('cursor-bottom')) {
                        nextCursor = item.content?.value || ''
                    }
                }
                this.updateInfo(`${formatNumber(bookmarks.length)} bookmarks collected…`)

                const remaining = response.headers.get('x-rate-limit-remaining')
                if (remaining !== null && parseInt(remaining, 10) < 1) this.setRateLimit(response, 60)

                // The last page repeats the cursor or has no new Tweets
                if (added === 0 || !nextCursor || nextCursor === cursor) break
                cursor = nextCursor
            }

            const link = this.ui.bookmarksDownload
            if (link.href) URL.revokeObjectURL(link.href)
            link.href = URL.createObjectURL(new Blob([JSON.stringify(bookmarks)], { type: 'application/json' }))
            link.hidden = false
            this.ui.advanced.open = true
            this.setBusy(false)
            this.updateTitle('TweetXer')
            this.updateInfo(`${formatNumber(bookmarks.length)} bookmarks exported. Use "Download bookmarks" to save them.`, 'success')
        },

        // ---------- Profile ----------

        async getTweetCount() {
            const header = await waitForElemToExist('header', 20000)
            if (!header) {
                this.log('The page did not load. Automatic skipping is disabled.')
                return
            }

            if (!document.querySelector('[data-testid="UserName"]')) {
                // Navigate to the own profile to read the Tweet count
                const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')
                if (profileLink) {
                    profileLink.click()
                } else {
                    // Mobile layout: the profile link is in the side drawer
                    const back = document.querySelector('[data-testid="app-bar-back"]')
                    if (back) {
                        back.click()
                        await sleep(1000)
                    }
                    const dashButton = document.querySelector('[data-testid="DashButton_ProfileIcon_Link"]')
                    if (dashButton) {
                        dashButton.click()
                        const drawerProfile = await waitForElemToExist('[data-testid="SheetDialog"] a[href^="/"], [role="dialog"] a[href^="/"]', 3000)
                        drawerProfile?.click()
                    }
                }
                await waitForElemToExist('[data-testid="UserName"]', 10000)
            }
            await sleep(1000)

            this.username = this.getUsername()
            const count = this.extractTweetCount('[data-testid="primaryColumn"] h2 ~ div')
                ?? this.extractTweetCount('[data-testid="primaryColumn"]>div>div>div')
                ?? this.extractTweetCount('[data-testid="TopNavBar"]>div>div')

            if (count === null) {
                this.TweetCount = null
                this.log("Couldn't find the Tweet count on your profile. Automatic skipping is disabled.")
            } else {
                this.TweetCount = count
                this.log(`${formatNumber(count)} Tweets on profile.`)
            }
        },

        extractTweetCount(selector) {
            for (const element of document.querySelectorAll(selector)) {
                const text = element.textContent.trim()
                // e.g. "12.3K posts", short enough to not be a whole column
                if (text.length > 0 && text.length < 120 && /\d/.test(text)) {
                    const count = parseCount(text)
                    if (count !== null) return count
                }
            }
            return null
        },

        // ---------- DOM based actions ----------

        async slowDelete() {
            if (this.running) return
            this.setBusy(true)
            this.updateTitle('Slow delete')
            await this.tweetCountReady
            this.startProgress(this.TweetCount || 0)

            const repliesTab = document.querySelectorAll('[data-testid="ScrollSnap-List"] a')[1]
            if (repliesTab) {
                repliesTab.click()
                await sleep(2000)
            }

            const more = '[data-testid="tweet"] [data-testid="caret"]'
            let consecutiveErrors = 0
            const maxConsecutiveErrors = 5

            while (!this.stopRequested) {
                let caret = await waitForElemToExist(more, 5000)
                if (!caret) {
                    // Load more Tweets
                    window.scrollTo(0, document.body.scrollHeight)
                    caret = await waitForElemToExist(more, 8000)
                    if (!caret) break
                }

                // Give the Tweets a chance to load; afaik the limit is 50 requests per minute
                await sleep(1200)
                // Hide recommended profiles and stuff
                document.querySelectorAll('section [data-testid="cellInnerDiv"]>div>div>div, section [data-testid="cellInnerDiv"]>div>div>[role="link"]').forEach((x) => x.remove())

                try {
                    const tweet = document.querySelector('[data-testid="tweet"]')
                    if (!tweet) continue
                    tweet.scrollIntoView({ block: 'center' })

                    const unretweet = tweet.querySelector('[data-testid="unretweet"]')
                    if (unretweet) {
                        unretweet.click()
                        const confirm = await waitForElemToExist('[data-testid="unretweetConfirm"]', 5000)
                        if (!confirm) throw new Error('unretweet confirmation did not appear')
                        confirm.click()
                    } else {
                        const tweetCaret = tweet.querySelector('[data-testid="caret"]')
                        if (!tweetCaret) {
                            tweet.remove()
                            continue
                        }
                        tweetCaret.click()
                        const menuItem = await waitForElemToExist('[role="menuitem"]', 5000)
                        if (!menuItem) throw new Error('menu did not open')

                        if (menuItem.textContent.includes('@')) {
                            // Not our Tweet (the first item is "Follow/Unfollow @user"), e.g. the parent in the replies tab
                            tweetCaret.click()
                            tweet.remove()
                            await sleep(300)
                            continue
                        }
                        menuItem.click()
                        const confirm = await waitForElemToExist('[data-testid="confirmationSheetConfirm"]', 5000)
                        if (!confirm) throw new Error('delete confirmation did not appear')
                        confirm.click()
                    }

                    this.dCount++
                    if (this.dCount > this.total) this.total = this.dCount
                    this.updateProgressBar()
                    consecutiveErrors = 0
                } catch (error) {
                    this.log(`Error deleting Tweet: ${error.message}`)
                    if (++consecutiveErrors >= maxConsecutiveErrors) {
                        this.log(`${consecutiveErrors} consecutive errors. Stopping.`)
                        break
                    }
                }
            }

            this.finish(this.stopRequested
                ? `Stopped. ${formatNumber(this.dCount)} Tweets deleted.`
                : `Finished. ${formatNumber(this.dCount)} Tweets deleted. Reload the page to confirm.`)
            this.updateTitle('TweetXer')
        },

        async unfollow() {
            if (this.running) return
            const followingLink = document.querySelector('a[href$="/following"]')
            if (!followingLink && !location.pathname.endsWith('/following')) {
                this.updateInfo('Open your profile first, then try again.', 'error')
                return
            }
            this.setBusy(true)
            this.updateTitle('Unfollowing everyone')
            followingLink?.click()
            await waitForElemToExist('[data-testid="UserCell"]', 10000)

            let unfollowCount = 0
            const button = '[data-testid="UserCell"] [data-testid$="-unfollow"]'
            while (!this.stopRequested) {
                let next = document.querySelector(button)
                if (!next) {
                    window.scrollTo(0, document.body.scrollHeight)
                    next = await waitForElemToExist(button, 5000)
                    if (!next) break
                }
                const cell = next.closest('[data-testid="UserCell"]')
                cell.scrollIntoView({ block: 'center' })
                next.click()
                const confirm = await waitForElemToExist('[data-testid="confirmationSheetConfirm"]', 5000)
                if (!confirm) {
                    this.log('The unfollow confirmation did not appear. You may be rate limited; try again later.')
                    break
                }
                confirm.click()
                cell.remove()
                unfollowCount++
                this.updateInfo(`Unfollowed ${formatNumber(unfollowCount)} accounts…`)
                await sleep(200 + Math.floor(Math.random() * 300))
            }

            this.finish(`Unfollowed ${formatNumber(unfollowCount)} accounts. Reload the page to confirm.`)
            this.updateTitle('TweetXer')
        },

        removeTweetXer() {
            if (TweetsXer.running && !confirm('TweetXer is still running. Stop it and remove TweetXer?')) return
            TweetsXer.destroy()
        },
    }

    window.__tweetXer = TweetsXer
    TweetsXer.init()
})()
