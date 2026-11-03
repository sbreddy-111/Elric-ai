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

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Error
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Quiz
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.ShoppingBag
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.data.BuiltInTaskId
import com.google.ai.edge.gallery.ui.common.tos.AppTosDialog
import com.google.ai.edge.gallery.ui.common.tos.TosViewModel
import com.google.ai.edge.gallery.ui.home.SettingsDialog
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel
import com.google.ai.edge.gallery.ui.theme.ElricGold
import com.google.ai.edge.gallery.ui.theme.ElricIndigo
import com.google.ai.edge.gallery.ui.theme.ElricSuccess
import com.google.android.gms.oss.licenses.OssLicensesMenuActivity
import kotlinx.coroutines.launch

/** The three Elric modes shown in the top bar picker. */
enum class ElricMode(@StringRes val labelRes: Int) {
  STUDY(R.string.elric_mode_study),
  SHOPPING(R.string.elric_mode_shopping),
  GENERAL(R.string.elric_mode_general),
}

private data class ElricSuggestion(
  @StringRes val textRes: Int,
  val icon: ImageVector,
  /** Task opened when tapped. */
  val taskId: String,
  /** Whether the suggestion text is sent as the first chat message. */
  val sendAsPrompt: Boolean,
)

private val SUGGESTIONS =
  listOf(
    ElricSuggestion(
      R.string.elric_suggestion_photo,
      Icons.Rounded.PhotoCamera,
      BuiltInTaskId.LLM_ASK_IMAGE,
      sendAsPrompt = false,
    ),
    ElricSuggestion(
      R.string.elric_suggestion_lecture,
      Icons.Rounded.Description,
      BuiltInTaskId.LLM_ASK_AUDIO,
      sendAsPrompt = false,
    ),
    ElricSuggestion(
      R.string.elric_suggestion_quiz,
      Icons.Rounded.Quiz,
      BuiltInTaskId.LLM_CHAT,
      sendAsPrompt = true,
    ),
    ElricSuggestion(
      R.string.elric_suggestion_watch,
      Icons.Rounded.ShoppingBag,
      BuiltInTaskId.LLM_CHAT,
      sendAsPrompt = true,
    ),
  )

/**
 * Elric AI's chat-first start screen.
 *
 * @param onOpenTask opens an existing task screen by task id, optionally handing it a first prompt.
 */
@Composable
fun ElricHomeScreen(
  modelManagerViewModel: ModelManagerViewModel,
  tosViewModel: TosViewModel,
  onOpenTask: (taskId: String, prompt: String?) -> Unit,
  onAllToolsClicked: () -> Unit,
  onModelsClicked: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val uiState by modelManagerViewModel.uiState.collectAsState()
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
  var mode by rememberSaveable { mutableStateOf(ElricMode.STUDY) }
  var input by rememberSaveable { mutableStateOf("") }
  var showSettingsDialog by remember { mutableStateOf(false) }
  var showTosDialog by remember { mutableStateOf(!tosViewModel.getIsTosAccepted()) }

  BackHandler(drawerState.isOpen) { scope.launch { drawerState.close() } }

  fun closeDrawerThen(action: () -> Unit) {
    scope.launch { drawerState.close() }
    action()
  }

  fun send() {
    val text = input.trim()
    if (text.isEmpty()) return
    onOpenTask(BuiltInTaskId.LLM_CHAT, text)
    input = ""
  }

  ModalNavigationDrawer(
    drawerState = drawerState,
    drawerContent = {
      ModalDrawerSheet {
        Text(
          stringResource(R.string.app_name),
          style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
          modifier = Modifier.padding(start = 28.dp, top = 24.dp, bottom = 16.dp),
        )
        ElricDrawerItem(Icons.Rounded.Apps, R.string.elric_drawer_all_tools) {
          closeDrawerThen(onAllToolsClicked)
        }
        ElricDrawerItem(Icons.Rounded.Memory, R.string.elric_drawer_models) {
          closeDrawerThen(onModelsClicked)
        }
        ElricDrawerItem(Icons.Rounded.Settings, R.string.elric_drawer_settings) {
          closeDrawerThen { showSettingsDialog = true }
        }
        HorizontalDivider(modifier = Modifier.padding(horizontal = 28.dp, vertical = 8.dp))
        ElricDrawerItem(Icons.Rounded.Description, R.string.elric_drawer_licenses) {
          closeDrawerThen { context.startActivity(Intent(context, OssLicensesMenuActivity::class.java)) }
        }
      }
    },
  ) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = modifier.fillMaxSize()) {
      Column(
        modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()
      ) {
        ElricTopBar(
          mode = mode,
          onModeSelected = { mode = it },
          onMenuClicked = { scope.launch { drawerState.open() } },
          onNewChatClicked = { onOpenTask(BuiltInTaskId.LLM_CHAT, null) },
        )
        PrivacyPill(mode = mode, modifier = Modifier.align(Alignment.CenterHorizontally))

        Column(
          modifier =
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(
              horizontal = 20.dp
            ),
          verticalArrangement = Arrangement.Center,
        ) {
          Spacer(modifier = Modifier.height(24.dp))
          Text(
            stringResource(R.string.elric_greeting),
            style =
              TextStyle(
                brush = Brush.linearGradient(listOf(ElricGold, ElricIndigo)),
                fontSize = 36.sp,
                lineHeight = 44.sp,
                fontWeight = FontWeight.SemiBold,
              ),
          )
          Spacer(modifier = Modifier.height(6.dp))
          Text(
            stringResource(R.string.elric_subtitle),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          Spacer(modifier = Modifier.height(28.dp))
          for (suggestion in SUGGESTIONS) {
            val text = stringResource(suggestion.textRes)
            SuggestionCard(
              text = text,
              icon = suggestion.icon,
              onClick = {
                onOpenTask(suggestion.taskId, if (suggestion.sendAsPrompt) text else null)
              },
            )
            Spacer(modifier = Modifier.height(10.dp))
          }
          Spacer(modifier = Modifier.height(16.dp))
        }

        Composer(
          value = input,
          onValueChange = { input = it },
          onSend = { send() },
          onSnap = { onOpenTask(BuiltInTaskId.LLM_ASK_IMAGE, null) },
          onMic = { onOpenTask(BuiltInTaskId.LLM_CHAT, null) },
          modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
      }
    }
  }

  if (showTosDialog) {
    AppTosDialog(
      onTosAccepted = {
        showTosDialog = false
        tosViewModel.acceptTos()
      }
    )
  }

  if (showSettingsDialog) {
    SettingsDialog(
      curThemeOverride = modelManagerViewModel.readThemeOverride(),
      curFirebaseAnalytics = modelManagerViewModel.readFirebaseAnalytics(),
      modelManagerViewModel = modelManagerViewModel,
      onDismissed = { showSettingsDialog = false },
    )
  }

  if (uiState.loadingModelAllowlistError.isNotEmpty()) {
    AlertDialog(
      icon = {
        Icon(
          Icons.Rounded.Error,
          contentDescription = stringResource(R.string.cd_error),
          tint = MaterialTheme.colorScheme.error,
        )
      },
      title = { Text(uiState.loadingModelAllowlistError) },
      text = { Text(stringResource(R.string.error_internet_connection)) },
      onDismissRequest = { modelManagerViewModel.loadModelAllowlist() },
      confirmButton = {
        TextButton(onClick = { modelManagerViewModel.loadModelAllowlist() }) {
          Text(stringResource(R.string.retry))
        }
      },
      dismissButton = {
        TextButton(onClick = { modelManagerViewModel.clearLoadModelAllowlistError() }) {
          Text(stringResource(R.string.cancel))
        }
      },
    )
  }
}

@Composable
private fun ElricDrawerItem(icon: ImageVector, @StringRes labelRes: Int, onClick: () -> Unit) {
  NavigationDrawerItem(
    icon = { Icon(icon, contentDescription = null) },
    label = { Text(stringResource(labelRes)) },
    selected = false,
    onClick = onClick,
    modifier = Modifier.padding(horizontal = 12.dp),
  )
}

@Composable
private fun ElricTopBar(
  mode: ElricMode,
  onModeSelected: (ElricMode) -> Unit,
  onMenuClicked: () -> Unit,
  onNewChatClicked: () -> Unit,
) {
  var menuOpen by remember { mutableStateOf(false) }
  Row(
    modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    IconButton(onClick = onMenuClicked) {
      Icon(Icons.Rounded.Menu, contentDescription = stringResource(R.string.elric_cd_menu))
    }
    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
      Row(
        modifier =
          Modifier.clip(RoundedCornerShape(20.dp))
            .clickable { menuOpen = true }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          stringResource(R.string.elric_mode_title, stringResource(mode.labelRes)),
          style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        )
        Icon(
          Icons.Rounded.KeyboardArrowDown,
          contentDescription = stringResource(R.string.elric_cd_change_mode),
          modifier = Modifier.size(20.dp),
        )
      }
      DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
        for (m in ElricMode.entries) {
          DropdownMenuItem(
            text = { Text(stringResource(m.labelRes)) },
            trailingIcon = {
              if (m == mode) {
                Icon(Icons.Rounded.Check, contentDescription = null, tint = ElricGold)
              }
            },
            onClick = {
              onModeSelected(m)
              menuOpen = false
            },
          )
        }
      }
    }
    IconButton(onClick = onNewChatClicked) {
      Icon(
        Icons.Outlined.AddComment,
        contentDescription = stringResource(R.string.elric_cd_new_chat),
      )
    }
  }
}

@Composable
private fun PrivacyPill(mode: ElricMode, modifier: Modifier = Modifier) {
  val online = mode == ElricMode.SHOPPING
  val color = if (online) ElricIndigo else ElricSuccess
  val label =
    stringResource(if (online) R.string.elric_privacy_online else R.string.elric_privacy_on_device)
  Row(
    modifier =
      modifier
        .clip(CircleShape)
        .background(color.copy(alpha = 0.14f))
        .padding(horizontal = 12.dp, vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(Icons.Rounded.Shield, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
    Spacer(modifier = Modifier.width(6.dp))
    Text(label, color = color, style = MaterialTheme.typography.labelLarge)
  }
}

@Composable
private fun SuggestionCard(text: String, icon: ImageVector, onClick: () -> Unit) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(16.dp),
    color = MaterialTheme.colorScheme.surfaceContainer,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(icon, contentDescription = null, tint = ElricGold, modifier = Modifier.size(22.dp))
      Spacer(modifier = Modifier.width(14.dp))
      Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
    }
  }
}

@Composable
private fun Composer(
  value: String,
  onValueChange: (String) -> Unit,
  onSend: () -> Unit,
  onSnap: () -> Unit,
  onMic: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Row(
    modifier =
      modifier
        .fillMaxWidth()
        .heightIn(min = 56.dp)
        .clip(RoundedCornerShape(28.dp))
        .background(MaterialTheme.colorScheme.surfaceContainerHigh)
        .padding(horizontal = 6.dp, vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    // Gold round Snap button.
    Box(
      modifier =
        Modifier.size(44.dp).clip(CircleShape).background(ElricGold).clickable(onClick = onSnap),
      contentAlignment = Alignment.Center,
    ) {
      Icon(
        Icons.Rounded.PhotoCamera,
        contentDescription = stringResource(R.string.elric_cd_snap),
        tint = Color(0xFF1A1405),
      )
    }
    Spacer(modifier = Modifier.width(10.dp))
    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
      if (value.isEmpty()) {
        Text(
          stringResource(R.string.elric_composer_hint),
          style = MaterialTheme.typography.bodyLarge,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle =
          MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        cursorBrush = SolidColor(ElricGold),
        maxLines = 5,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { onSend() }),
        modifier = Modifier.fillMaxWidth(),
      )
    }
    IconButton(onClick = onMic) {
      Icon(Icons.Rounded.Mic, contentDescription = stringResource(R.string.elric_cd_mic))
    }
    val canSend = value.isNotBlank()
    IconButton(onClick = onSend, enabled = canSend) {
      Icon(
        Icons.AutoMirrored.Rounded.Send,
        contentDescription = stringResource(R.string.elric_cd_send),
        tint = if (canSend) ElricGold else MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
