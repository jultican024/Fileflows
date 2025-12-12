/**
 * @description Bazarr helper: resolve Sonarr series/episode IDs and trigger provider search
 * @author John
 * @revision 13
 * @param {string} uri Bazarr server URI
 * @param {string} apiKey Bazarr API key
 * @output Bazarr API helper functions
 */
export class Bazarr {
    constructor(uri, apiKey) {
        this.URL = (uri || '').replace(/\/$/, '');
        this.ApiKey = apiKey || '';
        Logger.DLog('Bazarr helper initialized with URI=' + this.URL);
    }

    buildUrl(endpoint) {
        endpoint = endpoint || '';
        var base = this.URL + endpoint;
        var sep = endpoint.indexOf('?') >= 0 ? '&' : '?';
        return base + sep + 'apikey=' + this.ApiKey;
    }

    sendGet(endpoint) {
        var url = this.buildUrl(endpoint);
        Logger.DLog('GET ' + url);
        var response = http.GetAsync(url).Result;
        var status = 0, ok = false, body = '';
        try {
            if (response) {
                status = response.StatusCode || 0;
                ok = response.IsSuccessStatusCode === true;
                if (response.Content && response.Content.ReadAsStringAsync) {
                    var rs = response.Content.ReadAsStringAsync().Result;
                    body = rs ? rs : '';
                }
            }
        } catch (e) {
            Logger.WLog('GET response handling error: ' + (e && e.message ? e.message : e));
        }
        Logger.DLog(`Response status=${status}, ok=${ok}, body length=${body.length}`);
        return { ok: ok, status: status, body: body };
    }

    normalizeTitle(str) {
        return String(str || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }
    stripYear(str) {
        return String(str || '').replace(/\(\d{4}\)/g, '').trim();
    }

    findSonarrSeriesIdBySearch(showName) {
        var r = this.sendGet('/api/system/searches?query=' + encodeURIComponent(showName));
        if (!r.ok) return null;
        var results = [];
        try { results = JSON.parse(r.body || '[]'); } catch { results = []; }
        Logger.DLog(`Search results count=${results.length}`);
        if (!results || !results.length) return null;

        var normalizedTarget = this.normalizeTitle(showName);
        var normalizedTargetNoYear = this.normalizeTitle(this.stripYear(showName));

        for (var i = 0; i < results.length; i++) {
            var s = results[i] || {};
            Logger.DLog(`Search result[${i}] title="${s.title}" sonarrSeriesId=${s.sonarrSeriesId}`);
            var titleNorm = this.normalizeTitle(s.title || '');
            if ((titleNorm === normalizedTarget || titleNorm === normalizedTargetNoYear) && s.sonarrSeriesId) {
                Logger.ILog('Bazarr search matched "' + (s.title || '') + '" → sonarrSeriesId=' + s.sonarrSeriesId);
                return s.sonarrSeriesId;
            }
        }
        return null;
    }

    findSonarrSeriesIdByList(showName) {
        var r = this.sendGet('/api/series');
        if (!r.ok) return null;
        var seriesList = [];
        try { seriesList = JSON.parse(r.body || '[]'); } catch { seriesList = []; }
        Logger.DLog(`Series list count=${seriesList.length}`);
        if (!seriesList || !seriesList.length) return null;

        var target = this.normalizeTitle(showName);
        var targetNoYear = this.normalizeTitle(this.stripYear(showName));

        for (var i = 0; i < seriesList.length; i++) {
            var s = seriesList[i] || {};
            Logger.DLog(`Series[${i}] title="${s.title}" sonarrSeriesId=${s.sonarrSeriesId}`);
            var titleNorm = this.normalizeTitle(s.title || '');
            if ((titleNorm === target || titleNorm === targetNoYear) && s.sonarrSeriesId) {
                Logger.ILog('Bazarr list matched "' + (s.title || '') + '" → sonarrSeriesId=' + s.sonarrSeriesId);
                return s.sonarrSeriesId;
            }
        }
        return null;
    }

    getEpisodes(seriesId) {
        var r = this.sendGet('/api/episodes?seriesid[]=' + seriesId);
        if (!r.ok) {
            Logger.WLog(`Bazarr /api/episodes call failed status=${r.status}`);
            return [];
        }
        Logger.DLog(`Raw episodes body (first 500 chars): ${r.body.substring(0, 500)}...`);
        var parsed = {};
        try { parsed = JSON.parse(r.body || '{}'); } catch (e) {
            Logger.WLog(`Failed to parse episodes JSON: ${e}`);
            return [];
        }
        if (!parsed || !parsed.data) {
            Logger.WLog('Episodes JSON missing "data" property');
            return [];
        }
        Logger.DLog(`Parsed episodes count=${parsed.data.length}`);
        return parsed.data;
    }

    triggerProviderSearch(episodeId) {
        // Correct endpoint: query parameter
        var r = this.sendGet('/api/providers/episodes?episodeid=' + episodeId);
        Logger.DLog(`Provider search response status=${r.status}, ok=${r.ok}, body=${r.body}`);
        if (r.ok) {
            Logger.ILog('Bazarr provider search triggered for episodeId=' + episodeId);
            return true;
        }
        Logger.WLog('Bazarr provider search failed for episodeId=' + episodeId);
        return false;
    }
}
