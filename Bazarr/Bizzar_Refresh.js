import { Bazarr } from 'Shared/Bazarr';

/**
 * @description Trigger Bazarr provider search for converted recordings
 * @author John
 * @revision 14
 * @param {string} URI Bazarr server URI
 * @param {string} ApiKey Bazarr API key
 * @param {string} WinRoot Windows root path
 * @param {string} LinuxRoot Linux root path
 * @output Provider search triggered successfully
 * @output Provider search failed
 */
function remapPath(winPath, winRoot, linuxRoot) {
    if (!winPath || !winRoot || !linuxRoot) return winPath;
    var normalizedWinRoot = winRoot.replace(/\\/g, '/');
    var normalizedFile = winPath.replace(/\\/g, '/');
    if (normalizedFile.toLowerCase().startsWith(normalizedWinRoot.toLowerCase())) {
        return linuxRoot + normalizedFile.substring(normalizedWinRoot.length);
    }
    return winPath;
}

function stripYearSuffix(name) {
    return String(name || '').replace(/\(\d{4}\)/g, '').trim();
}

function Script(URI, ApiKey, WinRoot, LinuxRoot) {
    const bazarr = new Bazarr(URI, ApiKey);

    try {
        const fullPath = Variables.file.FullName;
        if (!fullPath) {
            Logger.WLog("No working file set, cannot trigger Bazarr search");
            return -1;
        }

        const remappedPath = remapPath(fullPath, WinRoot, LinuxRoot).toLowerCase();
        Logger.ILog("Looking for episode with path=" + remappedPath);

        let showFolder = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(System.IO.Path.GetDirectoryName(fullPath)));
        let searchName = stripYearSuffix(showFolder);
        Logger.ILog(`Resolving Sonarr series ID using searchName="${searchName}"`);

        const seriesId = bazarr.findSonarrSeriesIdBySearch(searchName) || bazarr.findSonarrSeriesIdByList(searchName);
        if (!seriesId) {
            Logger.WLog(`Unable to resolve Sonarr series ID for "${searchName}"`);
            return -1;
        }

        const episodes = bazarr.getEpisodes(seriesId);
        Logger.DLog(`Bazarr returned ${episodes.length} episodes for seriesId=${seriesId}`);

        let episodeId = null;
        for (let i = 0; i < episodes.length; i++) {
            const ep = episodes[i];
            if (ep.path) {
                const epPath = ep.path.toLowerCase();
                const epFile = System.IO.Path.GetFileName(epPath);
                const remFile = System.IO.Path.GetFileName(remappedPath);
                Logger.DLog(`Episode[${i}] path="${epPath}", file="${epFile}" vs remapped="${remappedPath}", file="${remFile}"`);

                if (epFile === remFile || remappedPath.endsWith(epPath) || epPath.endsWith(remappedPath)) {
                    episodeId = ep.sonarrEpisodeId;
                    Logger.ILog(`Matched episode "${ep.title}" → sonarrEpisodeId=${episodeId}`);
                    break;
                }
            } else {
                Logger.DLog(`Episode[${i}] has no path property`);
            }
        }

        if (!episodeId) {
            Logger.WLog("No episode match found for path=" + remappedPath);
            return -1;
        }

        return bazarr.triggerProviderSearch(episodeId) ? 1 : -1;

    } catch (err) {
        Logger.WLog(`Error in BazarrSearch: ${err && err.message ? err.message : err}`);
        Logger.DLog(`Stack trace: ${err && err.stack ? err.stack : 'no stack'}`);
        return -1;
    }
}
