/*
 * Copyright 2026 Elric
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

package com.google.ai.edge.gallery.ui.elric

/**
 * In-memory hand-off of a prompt the user typed (or tapped) on the Elric home screen to the chat
 * screen it opens.
 *
 * This is deliberately not a navigation argument: navigation arguments can also be filled by deep
 * links from other apps, and only prompts the user entered inside Elric AI should be sent
 * automatically.
 */
object ElricPendingPrompt {
  private var taskId: String? = null
  private var prompt: String? = null

  @Synchronized
  fun set(taskId: String, prompt: String) {
    this.taskId = taskId
    this.prompt = prompt
  }

  /** Returns and clears the pending prompt if it was meant for [taskId]. */
  @Synchronized
  fun consume(taskId: String): String? {
    if (this.taskId != taskId) return null
    val p = prompt
    this.taskId = null
    this.prompt = null
    return p?.takeIf { it.isNotBlank() }
  }

  @Synchronized
  fun clear() {
    taskId = null
    prompt = null
  }
}
