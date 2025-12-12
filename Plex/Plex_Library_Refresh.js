import { Plex } from 'Shared/Plex';

/**
 * @description Refresh Plex using path-first strategy; resolves ratingKey by normalized title or full traversal, but never hard-fails on lookup.
 * @author John
 * @revision 18
 * @param {string} URI Plex server URI
 * @param {string} Token Plex authentication token
 * @param {string} SectionId Plex library section ID
 * @param {string} WinRoot Windows root path
 * @param {string} LinuxRoot Linux root path
 * @output Refresh triggered successfully
 * @output Refresh failed
 */
function remapPath(winPath, winRoot, linuxRoot) {
    Logger.DLog(`Remapping path: winPath=${winPath}, winRoot=${winRoot}, linuxRoot=${linuxRoot}`);
    if (!winPath || !winRoot || !linuxRoot) return winPath;
    const normalizedWinRoot = winRoot.replace(/\\/g, '/');
    const normalizedFile = winPath.replace(/\\/g, '/');
    if (normalizedFile.toLowerCase().startsWith(normalizedWinRoot.toLowerCase())) {
        const remapped = linuxRoot + normalizedFile.substring(normalizedWinRoot.length);
        Logger.DLog(`Remapped path=${remapped}`);
        return remapped;
    }
    Logger.DLog(`No remap applied, returning original path=${winPath}`);
    return winPath;
}

function Script(URI, Token, SectionId, WinRoot, LinuxRoot) {
    const plex = new Plex(URI, Token);

    try {
        const fullPath = Variables.file.FullName;
        if (!fullPath) {
            Logger.ILog(`No working file set, refreshing entire section ${SectionId}`);
            return plex.refreshSection(SectionId) ? 1 : -1;
        }

        const remappedPath = remapPath(fullPath, WinRoot, LinuxRoot);
        Logger.ILog(`Resolving ratingKey for file: ${fullPath} → ${remappedPath}`);

        // Try to resolve ratingKey; if not found, we still perform path refresh
        const ratingKey = plex.findRatingKey(SectionId, remappedPath);

        Logger.ILog(`Refreshing via path-first strategy${ratingKey ? ` (key=${ratingKey})` : ''}`);
        const ok = plex.tryRefreshEpisode(SectionId, ratingKey, remappedPath);
        return ok ? 1 : -1;

    } catch (err) {
        Logger.WLog(`Error calling Plex API: ${err?.message ?? err}`);
        Logger.DLog(`Stack trace: ${err?.stack ?? 'no stack'}`);
        return -1;
    }
}
