/**
 * @description Robust Plex helper: resolves ratingKeys by normalized title or grandparentKey, with path refresh fallback.
 * @author John
 * @revision 17
 * @param {string} uri Plex server URI
 * @param {string} token Plex authentication token
 * @output Plex API helper functions
 */
export class Plex {
    constructor(uri, token) {
        this.URL = uri.replace(/\/$/, '');
        this.Token = token;
        Logger.DLog(`Plex helper initialized with URI=${this.URL}`);
    }

    buildUrl(endpoint) {
        return `${this.URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}X-Plex-Token=${this.Token}`;
    }
    sendGet(endpoint) {
        const url = this.buildUrl(endpoint);
        Logger.DLog(`GET ${url}`);
        const response = http.GetAsync(url).Result;
        const body = response?.Content?.ReadAsStringAsync()?.Result ?? '';
        if (response?.IsSuccessStatusCode) {
            Logger.DLog(`GET success (${body.length} bytes)`);
            return { ok: true, status: response.StatusCode, body };
        }
        Logger.WLog(`GET failed: HTTP ${response?.StatusCode ?? 'unknown'} ${body || ''}`);
        return { ok: false, status: response?.StatusCode ?? 0, body };
    }

    // Endpoints
    refreshSection(sectionId) { return this.sendGet(`/library/sections/${sectionId}/refresh`).ok; }
    refreshSectionPath(sectionId, path) {
        const qp = `path=${encodeURIComponent(path)}`;
        return this.sendGet(`/library/sections/${sectionId}/refresh?${qp}`).ok;
    }
    refreshItemGet(key) { return this.sendGet(`/library/metadata/${key}/refresh`).ok; }
    getMetadata(key) { return this.sendGet(`/library/metadata/${key}`); }
    listSection(sectionId) { const r = this.sendGet(`/library/sections/${sectionId}/all`); return r.ok ? r.body : null; }
    listChildren(key) { const r = this.sendGet(`/library/metadata/${key}/children`); return r.ok ? r.body : null; }
    search(query) { const r = this.sendGet(`/search?query=${encodeURIComponent(query)}`); return r.ok ? r.body : null; }

    normalize(str) { return (str ?? '').trim().toLowerCase(); }
    parseAttributes(openTag) {
        const attrs = {};
        const attrRegex = /([\w:-]+)="([^"]*)"/g;
        let m;
        while ((m = attrRegex.exec(openTag)) !== null) attrs[this.normalize(m[1])] = m[2];
        return attrs;
    }

    // --- Show resolution ---
    findShowKey(sectionId, targetShowName) {
        const normalizedTarget = this.normalize(targetShowName.replace(/\(\d{4}\)/, '').trim());
        const sectionXml = this.listSection(sectionId);
        if (!sectionXml) return null;

        const openTagRegex = /<Directory\b[^>]*>/g;
        let tag;
        while ((tag = openTagRegex.exec(sectionXml)) !== null) {
            const attrs = this.parseAttributes(tag[0]);
            if (['show','movie','video'].includes(this.normalize(attrs['type']))) {
                const titleNorm = this.normalize(attrs['title']);
                const slugNorm = this.normalize(attrs['slug']);
                if (titleNorm === normalizedTarget || slugNorm === normalizedTarget) {
                    Logger.ILog(`Matched show in section: "${attrs['title']}" (key=${attrs['ratingkey']})`);
                    return attrs['ratingkey'];
                }
            }
        }

        // Fallback: search
        const searchXml = this.search(targetShowName);
        if (searchXml) {
            const sTagRx = /<Directory\b[^>]*>/g;
            let sTag;
            while ((sTag = sTagRx.exec(searchXml)) !== null) {
                const attrs = this.parseAttributes(sTag[0]);
                if (['show','movie','video'].includes(this.normalize(attrs['type']))) {
                    const titleNorm = this.normalize(attrs['title']);
                    if (titleNorm === normalizedTarget) {
                        Logger.ILog(`Matched show via search: "${attrs['title']}" (key=${attrs['ratingkey']})`);
                        return attrs['ratingkey'];
                    }
                }
            }
        }
        return null;
    }

    findEpisodeKeyFromShow(showKey, fileName) {
        const seasonsXml = this.listChildren(showKey);
        if (!seasonsXml) return null;

        const seasonOpenTagRegex = /<Directory\b[^>]*>/g;
        let sTag, seasons = [];
        while ((sTag = seasonOpenTagRegex.exec(seasonsXml)) !== null) {
            const attrs = this.parseAttributes(sTag[0]);
            if (this.normalize(attrs['type']) === 'season') {
                seasons.push({ key: attrs['ratingkey'], title: attrs['title'] });
            }
        }
        for (const season of seasons) {
            const episodesXml = this.listChildren(season.key);
            if (!episodesXml) continue;

            const videoBlockRegex = /<Video\b[^>]*>[\s\S]*?<\/Video>/g;
            let vBlock;
            while ((vBlock = videoBlockRegex.exec(episodesXml)) !== null) {
                const vAttrsMatch = /<Video\b([^>]*)>/.exec(vBlock);
                const vAttrs = vAttrsMatch ? this.parseAttributes(`<Video ${vAttrsMatch[1]}>`) : {};
                if (this.normalize(vAttrs['type']) !== 'episode') continue;
                const ratingKey = vAttrs['ratingkey'];

                const partRegex = /<Part\b[^>]*\bfile="([^"]+)"/g;
                let p;
                while ((p = partRegex.exec(vBlock)) !== null) {
                    const partFile = p[1];
                    const partName = partFile.split('/').pop();
                    if (this.normalize(partName) === this.normalize(fileName)) {
                        Logger.ILog(`Matched episode by filename="${fileName}" → key=${ratingKey}`);
                        return ratingKey;
                    }
                }
            }
        }
        return null;
    }

    // --- Refresh strategy ---
    tryRefreshEpisode(sectionId, ratingKey, filePath) {
        if (ratingKey && this.refreshItemGet(ratingKey)) {
            Logger.ILog(`Item refresh accepted for key=${ratingKey}`);
            return true;
        }

        // Try parent season
        if (ratingKey) {
            const meta = this.getMetadata(ratingKey);
            if (meta.ok) {
                const parentMatch = /parentRatingKey="(\d+)"/i.exec(meta.body) || /parentKey="\/library\/metadata\/(\d+)"/i.exec(meta.body);
                if (parentMatch) {
                    const seasonKey = parentMatch[1];
                    Logger.ILog(`Refreshing parent season key=${seasonKey}`);
                    if (this.refreshItemGet(seasonKey)) return true;
                }
            }
        }

        // Fallback: section path refresh
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/')) || filePath;
        Logger.ILog(`Section path refresh: section=${sectionId} path=${dirPath}`);
        return this.refreshSectionPath(sectionId, dirPath);
    }

    // Public
    findRatingKey(sectionId, filePath) {
        const fileName = (filePath || '').split('/').pop();
        const targetShow = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(filePath));
        Logger.ILog(`Resolving show="${targetShow}" filename="${fileName}"`);

        let showKey = this.findShowKey(sectionId, targetShow);
        if (!showKey) {
            Logger.WLog(`Unable to resolve show key for "${targetShow}"`);
            return null;
        }
        return this.findEpisodeKeyFromShow(showKey, fileName);
    }
}
