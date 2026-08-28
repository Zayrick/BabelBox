import type {TranslationServiceCredential} from '@/src/core/config/model'
import type {TranslationServiceInstance} from '@/src/core/config/translationServices'

export interface AddTranslationServicePayload {
  instance: TranslationServiceInstance
  credential: TranslationServiceCredential
}
