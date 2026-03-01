import React from 'react';
import { useParams } from 'react-router-dom';
import AIProvider from './AIProvider';
import RedmineConfig from './RedmineConfig';
import EmailSettings from './EmailSettings';
import GeneralSettings from './GeneralSettings';
import EmailTemplates from './EmailTemplates';
import WorkflowSettings from './WorkflowSettings';
import AIHelp from './AIHelp';
import AISituationReport from './AISituationReport';
import AIMemorySettings from './AIMemorySettings';
import Knowledge from './Knowledge';
import WeatherApiSettings from './WeatherApiSettings';
import SystemInfos from './SystemInfos';
import MunicipalContactsSettings from './MunicipalContactsSettings';
import OrganizationSettings from './OrganizationSettings';
import PlatformBlog from './PlatformBlog';
import Imports from './Imports';
import KeywordingAssistant from './KeywordingAssistant';
import ServicesCatalog from './ServicesCatalog';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import './AdminSettings.css';

type SettingsSection =
  | 'general-base'
  | 'general-citizen'
  | 'general-jurisdiction'
  | 'municipal-contacts'
  | 'general-languages'
  | 'general-operations'
  | 'general-maintenance'
  | 'systeminfos'
  | 'imports'
  | 'services'
  | 'keywording'
  | 'tenants'
  | 'organization'
  | 'weather-api'
  | 'categories'
  | 'ai'
  | 'email'
  | 'templates'
  | 'redmine'
  | 'workflow'
  | 'ai-situation'
  | 'ai-memory'
  | 'ai-pseudonyms'
  | 'ai-help'
  | 'platform-blog';

const GeneralBaseSettings: React.FC = () => <GeneralSettings view="base" />;
const GeneralCitizenSettings: React.FC = () => <GeneralSettings view="citizen" />;
const GeneralJurisdictionSettings: React.FC = () => <GeneralSettings view="jurisdiction" />;
const GeneralLanguageSettings: React.FC = () => <GeneralSettings view="languages" />;
const GeneralOperationsSettings: React.FC = () => <GeneralSettings view="operations" />;
const GeneralMaintenanceSettings: React.FC = () => <GeneralSettings view="maintenance" />;
const CategoriesSettings: React.FC = () => <Knowledge />;
const AISituationOverviewSettings: React.FC = () => <AISituationReport initialTab="reports" />;
const AIPseudonymSettings: React.FC = () => <AISituationReport initialTab="pseudonyms" />;
const TenantSettings: React.FC = () => <OrganizationSettings mode="tenants" />;
const OrganizationStructureSettings: React.FC = () => <OrganizationSettings mode="organization" />;

const SECTION_LABELS: Record<SettingsSection, { title: string; subtitle: string; icon: string }> = {
  'general-base': {
    title: 'Allgemein · Basis & Links',
    subtitle: 'Anwendungsname und Callback-Konfiguration',
    icon: 'fa-sliders',
  },
  'general-citizen': {
    title: 'Allgemein · Bürgerfrontend',
    subtitle: 'Wartungsmodus, Intake-Workflow und Meldungsformular',
    icon: 'fa-users-viewfinder',
  },
  'general-jurisdiction': {
    title: 'Allgemein · Zuständigkeit',
    subtitle: 'Ortsfilter, Geofence und Zuständigkeitsregeln',
    icon: 'fa-location-crosshairs',
  },
  'municipal-contacts': {
    title: 'Kommunale Ansprechpartner',
    subtitle: 'Zuständige Ortsbürgermeister je Ort/PLZ mit Fallback',
    icon: 'fa-user-tie',
  },
  'general-languages': {
    title: 'Allgemein · Sprachen',
    subtitle: 'Standardsprache, Sprachliste und Übersetzungen',
    icon: 'fa-language',
  },
  'general-operations': {
    title: 'Allgemein · Betriebsalarme',
    subtitle: 'Benachrichtigung bei Workflow-Abbrüchen',
    icon: 'fa-bell',
  },
  'general-maintenance': {
    title: 'Allgemein · Daten & Wartung',
    subtitle: 'Backup, Import und Gefahrenzone',
    icon: 'fa-database',
  },
  systeminfos: {
    title: 'Systeminfos',
    subtitle: 'Sessions, Tokens, DB-Struktur, Backend- und Build-Historie',
    icon: 'fa-server',
  },
  imports: {
    title: 'Importe',
    subtitle: 'CSV-Import für Benutzer, Organisationsstruktur und Leistungen mit Vorschau und Konfliktprüfung',
    icon: 'fa-file-import',
  },
  services: {
    title: 'Leistungen',
    subtitle: 'Leistungskatalog mandantenbezogen anzeigen, bearbeiten und deaktivieren',
    icon: 'fa-list-check',
  },
  keywording: {
    title: 'Schlagwort-Assistent',
    subtitle: 'Leistungsbasierte KI-Verschlagwortung mit Review, Konfidenzfilter und Übernahme',
    icon: 'fa-wand-magic-sparkles',
  },
  tenants: {
    title: 'Mandanten',
    subtitle: 'Mandantenstamm und Mandanten-Profile zentral verwalten',
    icon: 'fa-building',
  },
  organization: {
    title: 'Organisationsstruktur',
    subtitle: 'Organisationstypen, Hierarchie, Gruppenzuordnung und Zuständigkeits-Schlagworte im Mandanten',
    icon: 'fa-sitemap',
  },
  'weather-api': {
    title: 'Wetter API',
    subtitle: 'Provider, Zugriff und Verbindungstest für Wetterdaten',
    icon: 'fa-cloud-sun-rain',
  },
  categories: {
    title: 'Kategorien',
    subtitle: 'Kategorielogik, Zuordnung und Classify Prompt',
    icon: 'fa-tags',
  },
  ai: {
    title: 'KI-Einstellungen',
    subtitle: 'Verbindungen, Task-Routing und System-Prompts',
    icon: 'fa-bolt',
  },
  email: {
    title: 'E-Mail (SMTP/IMAP)',
    subtitle: 'Versandserver, Postfachzugriff und Absenderdaten',
    icon: 'fa-envelope',
  },
  templates: {
    title: 'E-Mail-Templates',
    subtitle: 'Vorlagen für Benachrichtigungen',
    icon: 'fa-file-lines',
  },
  'ai-situation': {
    title: 'KI-Lagebild',
    subtitle: 'Analyseablauf, Berichte, Historie und automatische Berichts-Mail',
    icon: 'fa-chart-line',
  },
  'ai-memory': {
    title: 'KI-Gedächtnis',
    subtitle: 'Memory-Einträge und Kontextregeln für Lagebild-Prompts',
    icon: 'fa-brain',
  },
  'ai-pseudonyms': {
    title: 'KI-Pseudonymisierung',
    subtitle: 'Pseudonym-Pools, Füllläufe und Mapping-Verwaltung',
    icon: 'fa-user-secret',
  },
  'ai-help': {
    title: 'KI-Hilfe',
    subtitle: 'Bedienfragen zum Admin-Backend',
    icon: 'fa-life-ring',
  },
  'platform-blog': {
    title: 'Plattform-Blog',
    subtitle: 'News, Changelog und Entwicklungsverlauf für das Platformportal',
    icon: 'fa-newspaper',
  },
  redmine: {
    title: 'Redmine',
    subtitle: 'Anbindung und Feldzuordnungen',
    icon: 'fa-diagram-project',
  },
  workflow: {
    title: 'Workflow-Definitionen',
    subtitle: 'Workflow-Editor und Ausführungsregeln',
    icon: 'fa-gear',
  },
};

const SECTION_ALIASES: Record<string, SettingsSection> = {
  general: 'general-base',
  'system-info': 'systeminfos',
  'translation-planner': 'general-languages',
  prompts: 'ai',
};

const isSection = (value: string): value is SettingsSection =>
  Object.prototype.hasOwnProperty.call(SECTION_LABELS, value);

const resolveSection = (value?: string): SettingsSection => {
  if (!value) return 'general-base';
  if (isSection(value)) return value;
  return SECTION_ALIASES[value] || 'general-base';
};

const SECTION_COMPONENTS: Record<SettingsSection, React.FC> = {
  'general-base': GeneralBaseSettings,
  'general-citizen': GeneralCitizenSettings,
  'general-jurisdiction': GeneralJurisdictionSettings,
  'municipal-contacts': MunicipalContactsSettings,
  'general-languages': GeneralLanguageSettings,
  'general-operations': GeneralOperationsSettings,
  'general-maintenance': GeneralMaintenanceSettings,
  systeminfos: SystemInfos,
  imports: Imports,
  services: ServicesCatalog,
  keywording: KeywordingAssistant,
  tenants: TenantSettings,
  organization: OrganizationStructureSettings,
  'weather-api': WeatherApiSettings,
  categories: CategoriesSettings,
  ai: AIProvider,
  email: EmailSettings,
  templates: EmailTemplates,
  'ai-situation': AISituationOverviewSettings,
  'ai-memory': AIMemorySettings,
  'ai-pseudonyms': AIPseudonymSettings,
  'ai-help': AIHelp,
  'platform-blog': PlatformBlog,
  redmine: RedmineConfig,
  workflow: WorkflowSettings,
};

const SECTION_CAPABILITY_REQUIREMENTS: Partial<Record<SettingsSection, string[]>> = {
  'general-base': ['settings.global.manage'],
  'general-citizen': ['settings.global.manage'],
  'general-jurisdiction': ['settings.global.manage'],
  'municipal-contacts': ['settings.global.manage'],
  'general-languages': ['settings.global.manage'],
  'general-operations': ['settings.global.manage'],
  'general-maintenance': ['maintenance.manage'],
  systeminfos: ['settings.system.manage'],
  imports: ['users.manage', 'settings.organization.global.manage', 'settings.organization.tenant.manage'],
  services: ['settings.organization.global.manage', 'settings.organization.tenant.manage', 'settings.categories.manage', 'tickets.read', 'workflows.read'],
  keywording: ['users.manage', 'settings.organization.global.manage', 'settings.organization.tenant.manage', 'settings.categories.manage'],
  tenants: ['settings.organization.global.manage'],
  organization: ['settings.organization.global.manage', 'settings.organization.tenant.manage'],
  'weather-api': ['settings.weather.manage'],
  categories: ['settings.categories.manage'],
  ai: ['settings.ai.global.manage'],
  email: ['settings.email.global.manage', 'settings.email.tenant.manage'],
  templates: ['settings.templates.manage'],
  redmine: ['settings.redmine.manage'],
  workflow: ['settings.workflows.manage'],
  'ai-situation': ['settings.ai_situation.read', 'settings.ai_situation.manage'],
  'ai-memory': ['settings.ai.global.manage'],
  'ai-pseudonyms': ['settings.ai_pseudonyms.manage'],
  'ai-help': ['settings.ai.global.manage', 'settings.ai_situation.read', 'settings.ai_situation.manage'],
  'platform-blog': ['settings.platform_blog.manage'],
};

const AdminSettings: React.FC = () => {
  const { capabilities, effectiveRole } = useAdminScopeContext();
  const { section } = useParams<{ section?: string }>();
  const activeSection = resolveSection(section);
  const requiredCapabilities = SECTION_CAPABILITY_REQUIREMENTS[activeSection] || [];
  const capabilitySet = new Set((capabilities || []).map((entry) => String(entry || '').trim()));
  const platformOnlySections = new Set<SettingsSection>(['ai-memory']);
  const platformSectionBlocked = platformOnlySections.has(activeSection) && effectiveRole !== 'PLATFORM_ADMIN';
  const hasAccess =
    !platformSectionBlocked &&
    (requiredCapabilities.length === 0 ||
      requiredCapabilities.some((capability) => capabilitySet.has(capability)));

  if (!hasAccess) {
    return (
      <div className="admin-settings-page">
        <div className="admin-settings-active-strip">
          <span className="admin-settings-badge">
            <i className="fa-solid fa-lock" /> Kein Zugriff
          </span>
          <span className="admin-settings-subtitle">
            Für diesen Einstellungsbereich fehlen die erforderlichen Berechtigungen.
          </span>
        </div>
      </div>
    );
  }

  const ActiveSectionComponent = SECTION_COMPONENTS[activeSection];
  const meta = SECTION_LABELS[activeSection];

  return (
    <div className="admin-settings-page">
      <div className="admin-settings-active-strip">
        <span className="admin-settings-badge">
          <i className={`fa-solid ${meta.icon}`} /> {meta.title}
        </span>
        <span className="admin-settings-subtitle">{meta.subtitle}</span>
        <span className="admin-settings-hint">
          <i className="fa-solid fa-bars" /> Bereich über die linke Navigation wechseln
        </span>
      </div>
      <div className="admin-settings-content">
        <ActiveSectionComponent />
      </div>
    </div>
  );
};

export default AdminSettings;
