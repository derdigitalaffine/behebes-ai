export type LanguageOption = {
  code: string;
  label: string;
  flag?: string;
  locale?: string;
  aiName?: string;
  dir?: 'ltr' | 'rtl';
};

export const LANGUAGES: LanguageOption[] = [
  { code: 'de', label: 'Deutsch', locale: 'de-DE', aiName: 'German', dir: 'ltr' },
  { code: 'en', label: 'English', locale: 'en-GB', aiName: 'English', dir: 'ltr' },
  { code: 'fr', label: 'Français', locale: 'fr-FR', aiName: 'French', dir: 'ltr' },
  { code: 'es', label: 'Español', locale: 'es-ES', aiName: 'Spanish', dir: 'ltr' },
  { code: 'it', label: 'Italiano', locale: 'it-IT', aiName: 'Italian', dir: 'ltr' },
  { code: 'pt', label: 'Português', locale: 'pt-PT', aiName: 'Portuguese', dir: 'ltr' },
  { code: 'nl', label: 'Nederlands', locale: 'nl-NL', aiName: 'Dutch', dir: 'ltr' },
  { code: 'ru', label: 'Русский', locale: 'ru-RU', aiName: 'Russian', dir: 'ltr' },
  { code: 'zh', label: '中文', locale: 'zh-CN', aiName: 'Chinese (Simplified)', dir: 'ltr' },
  { code: 'ar', label: 'العربية', locale: 'ar-SA', aiName: 'Arabic', dir: 'rtl' },
  { code: 'hi', label: 'हिन्दी', locale: 'hi-IN', aiName: 'Hindi', dir: 'ltr' },
  { code: 'bn', label: 'বাংলা', locale: 'bn-BD', aiName: 'Bengali', dir: 'ltr' },
  { code: 'ur', label: 'اردو', locale: 'ur-PK', aiName: 'Urdu', dir: 'rtl' },
  { code: 'id', label: 'Bahasa Indonesia', locale: 'id-ID', aiName: 'Indonesian', dir: 'ltr' },
  { code: 'ja', label: '日本語', locale: 'ja-JP', aiName: 'Japanese', dir: 'ltr' },
  { code: 'ko', label: '한국어', locale: 'ko-KR', aiName: 'Korean', dir: 'ltr' },
  { code: 'tr', label: 'Türkçe', locale: 'tr-TR', aiName: 'Turkish', dir: 'ltr' },
  { code: 'vi', label: 'Tiếng Việt', locale: 'vi-VN', aiName: 'Vietnamese', dir: 'ltr' },
  { code: 'pl', label: 'Polski', locale: 'pl-PL', aiName: 'Polish', dir: 'ltr' },
  { code: 'sw', label: 'Kiswahili', locale: 'sw-TZ', aiName: 'Swahili', dir: 'ltr' },
  { code: 'th', label: 'ไทย', locale: 'th-TH', aiName: 'Thai', dir: 'ltr' },
  { code: 'uk', label: 'Українська', locale: 'uk-UA', aiName: 'Ukrainian', dir: 'ltr' },
  { code: 'ro', label: 'Română', locale: 'ro-RO', aiName: 'Romanian', dir: 'ltr' },
  { code: 'cs', label: 'Čeština', locale: 'cs-CZ', aiName: 'Czech', dir: 'ltr' },
  { code: 'el', label: 'Ελληνικά', locale: 'el-GR', aiName: 'Greek', dir: 'ltr' },
  { code: 'sv', label: 'Svenska', locale: 'sv-SE', aiName: 'Swedish', dir: 'ltr' },
  { code: 'no', label: 'Norsk', locale: 'nb-NO', aiName: 'Norwegian', dir: 'ltr' },
  { code: 'da', label: 'Dansk', locale: 'da-DK', aiName: 'Danish', dir: 'ltr' },
  { code: 'fi', label: 'Suomi', locale: 'fi-FI', aiName: 'Finnish', dir: 'ltr' },
  { code: 'hu', label: 'Magyar', locale: 'hu-HU', aiName: 'Hungarian', dir: 'ltr' },
  { code: 'he', label: 'עברית', locale: 'he-IL', aiName: 'Hebrew', dir: 'rtl' },
  { code: 'fa', label: 'فارسی', locale: 'fa-IR', aiName: 'Persian', dir: 'rtl' },
  { code: 'ms', label: 'Bahasa Melayu', locale: 'ms-MY', aiName: 'Malay', dir: 'ltr' },
  { code: 'tl', label: 'Tagalog', locale: 'fil-PH', aiName: 'Tagalog', dir: 'ltr' },
  { code: 'ta', label: 'தமிழ்', locale: 'ta-IN', aiName: 'Tamil', dir: 'ltr' },
  { code: 'te', label: 'తెలుగు', locale: 'te-IN', aiName: 'Telugu', dir: 'ltr' },
  { code: 'mr', label: 'मराठी', locale: 'mr-IN', aiName: 'Marathi', dir: 'ltr' },
  { code: 'gu', label: 'ગુજરાતી', locale: 'gu-IN', aiName: 'Gujarati', dir: 'ltr' },
  { code: 'kn', label: 'ಕನ್ನಡ', locale: 'kn-IN', aiName: 'Kannada', dir: 'ltr' },
  { code: 'ml', label: 'മലയാളം', locale: 'ml-IN', aiName: 'Malayalam', dir: 'ltr' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', locale: 'pa-IN', aiName: 'Punjabi', dir: 'ltr' },
  { code: 'jv', label: 'Basa Jawa', locale: 'jv-ID', aiName: 'Javanese', dir: 'ltr' },
  { code: 'my', label: 'မြန်မာ', locale: 'my-MM', aiName: 'Burmese', dir: 'ltr' },
  { code: 'km', label: 'ខ្មែរ', locale: 'km-KH', aiName: 'Khmer', dir: 'ltr' },
  { code: 'lo', label: 'ລາວ', locale: 'lo-LA', aiName: 'Lao', dir: 'ltr' },
  { code: 'si', label: 'සිංහල', locale: 'si-LK', aiName: 'Sinhala', dir: 'ltr' },
  { code: 'ne', label: 'नेपाली', locale: 'ne-NP', aiName: 'Nepali', dir: 'ltr' },
  { code: 'zu', label: 'Zulu', locale: 'zu-ZA', aiName: 'Zulu', dir: 'ltr' },
  { code: 'af', label: 'Afrikaans', locale: 'af-ZA', aiName: 'Afrikaans', dir: 'ltr' },
  { code: 'sk', label: 'Slovenčina', locale: 'sk-SK', aiName: 'Slovak', dir: 'ltr' },
  { code: 'emoji', label: 'Emoji', locale: 'en-GB', aiName: 'Emoji', dir: 'ltr' },
];

export const DEFAULT_LANGUAGE = 'de';

export function getLanguageOption(code: string, languages: LanguageOption[] = LANGUAGES): LanguageOption {
  return languages.find((lang) => lang.code === code) || languages[0];
}
