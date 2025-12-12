import { Sonarr } from 'Shared/Sonarr';

/**
 * @description Refresh a series in Sonarr and rename episodes, resolving the series by folder name via lookup.
 * @author John
 * @revision 4
 * @param {string} URI Sonarr root URI and port (e.g. http://sonarr:8989)
 * @param {string} ApiKey API Key
 * @output Item refreshed successfully
 * @output Item not found
 */
function Script(URI, ApiKey) {
    URI = URI.replace(/\/$/, '');
    const sonarr = new Sonarr(URI, ApiKey);
    const folderPath = Variables.folder.Orig.FullName;

    // Resolve series by folder name
    const series = findSeriesByLookup(folderPath, sonarr);

    if (!series || !series.id || isNaN(series.id)) {
        Logger.WLog('Series not found for path: ' + folderPath);
        return 2;
    } else {
        Logger.ILog(`Series found: ${series.title} (id=${series.id})`);
    }

    try {
        const refreshBody = { seriesIds: [series.id], isNewSeries: false };
        const refreshData = sonarr.sendCommand('RefreshSeries', refreshBody);

        const refreshCompleted = extendedWaitForCompletion(refreshData.id, sonarr);
        if (!refreshCompleted) {
            Logger.WLog('Refresh failed');
            return -1;
        }

        // Rename files
        const needingRename = getFilesNeedingRenameBySeries(sonarr, series.id);
        if (needingRename.length === 0) {
            Logger.ILog('No episode files need renaming.');
            return 1;
        }

        const fileIds = needingRename.map(x => x.episodeFileId);
        const ok = renameFilesByIds(sonarr, series.id, fileIds, true);
        if (!ok) return -1;

        Logger.ILog(`Renamed ${fileIds.length} file(s) for seriesId=${series.id}`);
        return 1;

    } catch (error) {
        Logger.WLog('Error: ' + error.message);
        return -1;
    }
}

/**
 * Resolve series by folder name using Sonarr lookup API.
 */
function findSeriesByLookup(filePath, sonarr) {
    const seriesFolder = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(filePath));
    const normalizedName = seriesFolder.replace(/\(\d{4}\)/, '').trim();

    Logger.ILog(`Looking up series by name: "${normalizedName}"`);

    try {
        const results = sonarr.fetchJson(`series/lookup?term=${encodeURIComponent(normalizedName)}`, null);
        if (results && Array.isArray(results) && results.length > 0) {
            const match = results.find(s => s.title.toLowerCase() === normalizedName.toLowerCase()) || results[0];
            Logger.ILog(`Matched series via lookup: ${match.title} (id=${match.id})`);
            return match;
        }
    } catch (e) {
        Logger.WLog(`Lookup failed: ${e?.message ?? e}`);
    }

    // Fallback: search all shows by title
    const allSeries = sonarr.getAllShows();
    const match = allSeries.find(s => s.title.toLowerCase() === normalizedName.toLowerCase());
    if (match) {
        Logger.ILog(`Matched series via getAllShows: ${match.title} (id=${match.id})`);
        return match;
    }

    Logger.WLog(`Unable to resolve series for folder "${seriesFolder}"`);
    return null;
}

/**
 * Wait for a Sonarr command to complete.
 */
function extendedWaitForCompletion(commandId, sonarr, timeOut=600000) {
    const startTime = new Date().getTime();
    const timeout = isNaN(timeOut) || timeOut < 1000 ? 600000 : timeOut;
    const endpoint = `command/${commandId}`;

    while (new Date().getTime() - startTime <= timeout) {
        const response = sonarr.fetchJson(endpoint, '');
        if (response.status === 'completed') {
            Logger.ILog('Command completed!');
            return true;
        } else if (response.status === 'failed') {
            Logger.WLog(`Command ${commandId} failed`);
            return false;
        }
        Logger.ILog(`Checking status: ${response.status}`);
        Sleep(1000);
    }
    Logger.WLog(`Timeout: Command ${commandId} did not complete within ${timeout / 1000} seconds.`);
    return false;
}

/**
 * Get rename preview items for a series.
 */
function getFilesNeedingRenameBySeries(sonarr, seriesId) {
    try {
        const preview = sonarr.fetchJson(`rename?seriesId=${encodeURIComponent(seriesId)}`, null);
        if (!preview || !Array.isArray(preview)) {
            Logger.WLog('Rename preview failed.');
            return [];
        }
        const needingRename = preview
            .filter(x => x.existingPath && x.newPath && x.existingPath !== x.newPath)
            .map(x => ({
                seriesId: x.seriesId,
                existingPath: x.existingPath,
                newPath: x.newPath,
                episodeFileId: x.episodeFileId
            }));
        Logger.ILog(`Found ${needingRename.length} file(s) needing rename for seriesId=${seriesId}`);
        return needingRename;
    } catch (e) {
        Logger.WLog('Rename preview error: ' + (e?.message ?? e));
        return [];
    }
}

/**
 * Trigger Sonarr RenameFiles command.
 */
function renameFilesByIds(sonarr, seriesId, fileIds, wait = true) {
    try {
        const body = { name: 'RenameFiles', seriesId: seriesId, files: fileIds };
        Logger.ILog(`[Command] RenameFiles for seriesId=${seriesId}, count=${fileIds.length}`);
        const cmd = sonarr.sendCommand('RenameFiles', body);
        if (!cmd || !cmd.id) {
            Logger.WLog('RenameFiles: command did not return a valid id.');
            return false;
        }
        Logger.ILog(`RenameFiles command queued: id=${cmd.id}`);
        if (wait) {
            const ok = extendedWaitForCompletion(cmd.id, sonarr);
            if (!ok) {
                Logger.WLog('RenameFiles command failed or timed out.');
                return false;
            }
            Logger.ILog('RenameFiles command completed successfully.');
        }
        return true;
    } catch (err) {
        Logger.WLog('Error sending RenameFiles command: ' + (err?.message ?? err));
        return false;
    }
}
