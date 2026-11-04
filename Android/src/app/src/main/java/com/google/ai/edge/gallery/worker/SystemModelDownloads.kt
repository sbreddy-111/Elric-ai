/*
 * Copyright 2026 Elric AI
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.ai.edge.gallery.worker

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.core.content.edit
import java.io.File
import kotlinx.coroutines.delay

private const val TAG = "AGSystemDownloads"
private const val PREFS_NAME = "system_model_downloads"
private const val POLL_INTERVAL_MS = 500L

/**
 * Downloads model files with Android's system [DownloadManager].
 *
 * The system download service does the transfer, shows its own progress notification, waits for
 * the network and retries on its own, and keeps going when the app is closed. So the app needs no
 * foreground service of its own. [DownloadWorker] only polls the system download for progress and
 * runs the steps after it (rename, unzip). When WorkManager stops and reruns the worker, the rerun
 * attaches to the same system download instead of starting a new one: the download IDs are kept in
 * SharedPreferences, keyed by the work's model tag and the file being written.
 */
object SystemModelDownloads {

  /** How a system download ended. */
  sealed interface Outcome {
    /** The file was fully downloaded to [file] by the system download [id]. */
    data class Success(val file: File, val id: Long) : Outcome

    /** The download failed. [reason] is a `DownloadManager.ERROR_*` value or an HTTP status. */
    data class Failure(val reason: Int) : Outcome
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun manager(context: Context): DownloadManager? =
    context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager

  private fun key(workTag: String, target: File) = "$workTag|${target.absolutePath}"

  /**
   * Whether the system download service can write to [dir]: it's enabled and [dir] is in the app's
   * external files dir, which it may write to without any storage permission.
   */
  fun canDownloadTo(context: Context, dir: File): Boolean {
    if (manager(context) == null) return false
    val externalDir = context.getExternalFilesDir(null) ?: return false
    return try {
      dir.canonicalPath.startsWith(externalDir.canonicalPath)
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Downloads [url] to [target], or attaches to the system download of it that an earlier run of
   * the same work started, and suspends until it ends. Calls [onProgress] with the bytes downloaded
   * so far about twice a second.
   *
   * If the coroutine is cancelled, the system download keeps going, so a rerun of the work can
   * attach to it. Call [cancel] to stop it.
   */
  suspend fun download(
    context: Context,
    workTag: String,
    url: String,
    authorization: String?,
    title: String,
    target: File,
    onProgress: suspend (downloadedBytes: Long) -> Unit,
  ): Outcome {
    val dm = requireNotNull(manager(context)) { "DownloadManager unavailable" }
    val key = key(workTag, target)
    var id = prefs(context).getLong(key, -1L)
    if (id != -1L && queryStatus(dm, id) == null) {
      // The system forgot the download, e.g. its data was cleared.
      id = -1L
    }
    if (id == -1L) {
      // Start over: the system download service doesn't resume a partial file it didn't write.
      target.delete()
      target.parentFile?.mkdirs()
      val request =
        DownloadManager.Request(Uri.parse(url))
          .setTitle(title)
          .setDestinationUri(Uri.fromFile(target))
          .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
          .setAllowedOverMetered(true)
          .setAllowedOverRoaming(true)
          .setVisibleInDownloadsUi(false)
      if (authorization != null) {
        request.addRequestHeader("Authorization", authorization)
      }
      id = dm.enqueue(request)
      prefs(context).edit { putLong(key, id) }
      Log.d(TAG, "Started system download $id of '${target.name}'")
    } else {
      Log.d(TAG, "Attached to system download $id of '${target.name}'")
    }

    while (true) {
      val status = queryStatus(dm, id)
      if (status == null) {
        // Removed from outside, e.g. from the system's download list.
        prefs(context).edit { remove(key) }
        return Outcome.Failure(DownloadManager.ERROR_UNKNOWN)
      }
      when (status.status) {
        DownloadManager.STATUS_SUCCESSFUL -> {
          prefs(context).edit { remove(key) }
          val file = status.localPath?.let { File(it) }?.takeIf { it.exists() } ?: target
          return Outcome.Success(file, id)
        }
        DownloadManager.STATUS_FAILED -> {
          Log.w(TAG, "System download $id failed, reason ${status.reason}")
          prefs(context).edit { remove(key) }
          dm.remove(id)
          return Outcome.Failure(status.reason)
        }
        else -> onProgress(status.downloadedBytes)
      }
      delay(POLL_INTERVAL_MS)
    }
  }

  /**
   * Removes the finished system download [id] from the system's download list. Call once its file
   * was moved away from where the system wrote it: removing an entry deletes the file at its old
   * path, which no longer exists after the move.
   */
  fun forget(context: Context, id: Long) {
    try {
      manager(context)?.remove(id)
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't clean up system download $id: ${e.message}")
    }
  }

  /** Stops and deletes the system downloads of the work tagged [workTag], e.g. when the user cancels. */
  fun cancel(context: Context, workTag: String) {
    val prefs = prefs(context)
    val keys = prefs.all.keys.filter { it.startsWith("$workTag|") }
    if (keys.isEmpty()) return
    val dm = manager(context)
    prefs.edit {
      for (key in keys) {
        val id = prefs.getLong(key, -1L)
        if (id != -1L) {
          try {
            dm?.remove(id)
            Log.d(TAG, "Cancelled system download $id")
          } catch (e: Exception) {
            Log.w(TAG, "Couldn't cancel system download $id: ${e.message}")
          }
        }
        remove(key)
      }
    }
  }

  private class Status(
    val status: Int,
    val reason: Int,
    val downloadedBytes: Long,
    val localPath: String?,
  )

  private fun queryStatus(dm: DownloadManager, id: Long): Status? =
    dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
      if (!c.moveToFirst()) return null
      Status(
        status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
        reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
        downloadedBytes =
          c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
        localPath =
          c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))?.let {
            Uri.parse(it).path
          },
      )
    }
}
