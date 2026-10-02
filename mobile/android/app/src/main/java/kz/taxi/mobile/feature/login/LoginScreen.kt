package kz.taxi.mobile.feature.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.taxi.mobile.core.ApiConfig
import kz.taxi.mobile.core.ui.ErrorCard
import kz.taxi.mobile.core.ui.TaxiOutlinedField
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.core.ui.SectionCard
import kz.taxi.mobile.core.ui.SubmitButton
import kz.taxi.mobile.ui.AppViewModels

/**
 * Login against the development identity provider: any phone, code `0000`.
 */
@Composable
fun LoginScreen(
    baseUrl: String,
    onLoggedIn: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: LoginViewModel = viewModel(factory = AppViewModels.login(container))
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Spacer(modifier = Modifier.height(28.dp))
        Text(text = "Taxi Mobile", style = MaterialTheme.typography.headlineSmall)
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = "Вход по номеру телефона",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(20.dp))

        SectionCard {
            Text(
                text = "Демо-режим",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Это локальный стенд с тестовым провайдером идентификации. " +
                    "Подойдёт любой номер, а код подтверждения — ${ApiConfig.DEMO_CODE}. " +
                    "Например, ${ApiConfig.DEMO_PHONE}.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(modifier = Modifier.height(18.dp))

        TaxiOutlinedField(
            value = state.phone,
            onValueChange = viewModel::onPhoneChange,
            label = "Номер телефона",
            keyboardType = KeyboardType.Phone,
            isError = state.phoneError != null,
            supportingText = state.phoneError,
            enabled = !state.isSubmitting,
        )

        Spacer(modifier = Modifier.height(12.dp))

        TaxiOutlinedField(
            value = state.code,
            onValueChange = viewModel::onCodeChange,
            label = "Код подтверждения",
            keyboardType = KeyboardType.NumberPassword,
            isError = state.codeError != null,
            supportingText = state.codeError ?: "Для стенда — ${ApiConfig.DEMO_CODE}",
            enabled = !state.isSubmitting,
        )

        Spacer(modifier = Modifier.height(12.dp))

        TaxiOutlinedField(
            value = state.displayName,
            onValueChange = viewModel::onDisplayNameChange,
            label = "Имя (необязательно)",
            enabled = !state.isSubmitting,
        )

        Spacer(modifier = Modifier.height(16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "Режим оператора", style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = "Добавляет роль ADMIN — нужна для демо-пополнения счёта.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Switch(
                checked = state.operatorMode,
                onCheckedChange = viewModel::onOperatorModeChange,
                enabled = !state.isSubmitting,
            )
        }

        val error = state.error
        if (error != null) {
            Spacer(modifier = Modifier.height(16.dp))
            ErrorCard(error = error, onDismiss = viewModel::dismissError)
        }

        Spacer(modifier = Modifier.height(24.dp))

        SubmitButton(
            text = "Войти",
            inFlight = state.isSubmitting,
            onClick = { viewModel.submit(onLoggedIn) },
        )

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = "Шлюз: $baseUrl",
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(24.dp))
    }
}
