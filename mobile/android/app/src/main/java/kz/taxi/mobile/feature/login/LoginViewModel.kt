package kz.taxi.mobile.feature.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.ApiConfig
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.core.util.PhoneNumbers
import kz.taxi.mobile.data.dto.Roles
import kz.taxi.mobile.data.repo.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val phone: String = ApiConfig.DEMO_PHONE,
    val code: String = ApiConfig.DEMO_CODE,
    val displayName: String = "",
    /** When on, the session also carries `ADMIN`, which is what demo top-up requires. */
    val operatorMode: Boolean = false,
    val isSubmitting: Boolean = false,
    val error: ApiError? = null,
    val phoneError: String? = null,
    val codeError: String? = null,
)

class LoginViewModel(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onPhoneChange(value: String) = _state.update {
        it.copy(phone = value, phoneError = null, error = null)
    }

    fun onCodeChange(value: String) = _state.update {
        it.copy(code = value.filter(Char::isDigit).take(MAX_CODE_LENGTH), codeError = null, error = null)
    }

    fun onDisplayNameChange(value: String) = _state.update {
        it.copy(displayName = value, error = null)
    }

    fun onOperatorModeChange(enabled: Boolean) = _state.update {
        it.copy(operatorMode = enabled)
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun submit(onSuccess: () -> Unit) {
        val current = _state.value
        if (current.isSubmitting) return

        val phoneError = validatePhone(current.phone)
        val codeError = if (current.code.length < MIN_CODE_LENGTH) {
            "Введите код из ${MIN_CODE_LENGTH} цифр"
        } else {
            null
        }
        if (phoneError != null || codeError != null) {
            _state.update { it.copy(phoneError = phoneError, codeError = codeError) }
            return
        }

        _state.update { it.copy(isSubmitting = true, error = null) }
        viewModelScope.launch {
            val roles = buildList {
                add(Roles.CUSTOMER)
                if (current.operatorMode) add(Roles.ADMIN)
            }
            authRepository.login(
                phone = current.phone,
                code = current.code,
                displayName = current.displayName.ifBlank { null },
                roles = roles,
            )
                .onSuccess {
                    _state.update { it.copy(isSubmitting = false, error = null) }
                    onSuccess()
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isSubmitting = false, error = throwable.asApiError()) }
                }
        }
    }

    companion object {
        const val MIN_CODE_LENGTH = 4
        const val MAX_CODE_LENGTH = 6

        fun validatePhone(input: String): String? = PhoneNumbers.validationError(input)

        fun normalizePhone(input: String): String = PhoneNumbers.normalize(input)
    }
}
