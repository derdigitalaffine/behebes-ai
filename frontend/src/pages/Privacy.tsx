import React from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import './Privacy.css';

const Privacy: React.FC = () => {
  const { t } = useI18n();

  const controllerLines = [
    t('privacy_controller_line_1'),
    t('privacy_controller_line_2'),
    t('privacy_controller_line_3'),
    t('privacy_controller_line_4'),
  ];
  const dpoLines = [
    t('privacy_dpo_line_1'),
    t('privacy_dpo_line_2'),
    t('privacy_dpo_line_3'),
  ];
  const processingPoints = [
    t('privacy_processing_point_1'),
    t('privacy_processing_point_2'),
    t('privacy_processing_point_3'),
    t('privacy_processing_point_4'),
    t('privacy_processing_point_5'),
    t('privacy_processing_point_6'),
  ];
  const legalBasisPoints = [
    t('privacy_legal_basis_point_1'),
    t('privacy_legal_basis_point_2'),
    t('privacy_legal_basis_point_3'),
    t('privacy_legal_basis_point_4'),
  ];
  const recipientsPoints = [
    t('privacy_recipients_point_1'),
    t('privacy_recipients_point_2'),
    t('privacy_recipients_point_3'),
    t('privacy_recipients_point_4'),
    t('privacy_recipients_point_5'),
  ];
  const storagePoints = [
    t('privacy_storage_point_1'),
    t('privacy_storage_point_2'),
    t('privacy_storage_point_3'),
    t('privacy_storage_point_4'),
  ];
  const aiPoints = [
    t('privacy_ai_point_1'),
    t('privacy_ai_point_2'),
    t('privacy_ai_point_3'),
    t('privacy_ai_point_4'),
    t('privacy_ai_point_5'),
    t('privacy_ai_point_6'),
    t('privacy_ai_point_7'),
    t('privacy_ai_point_8'),
  ];
  const rightsPoints = [
    t('privacy_rights_point_1'),
    t('privacy_rights_point_2'),
    t('privacy_rights_point_3'),
    t('privacy_rights_point_4'),
    t('privacy_rights_point_5'),
    t('privacy_rights_point_6'),
    t('privacy_rights_point_7'),
  ];
  const contactPoints = [
    t('privacy_contact_point_1'),
    t('privacy_contact_point_2'),
    t('privacy_contact_point_3'),
  ];

  return (
    <main className="privacy-page">
      <div className="privacy-top-actions">
        <Link to="/" className="privacy-back-btn">
          <i className="fa-solid fa-arrow-left" /> {t('privacy_back_to_form')}
        </Link>
      </div>

      <section className="privacy-hero">
        <p className="privacy-kicker">{t('privacy_page_kicker')}</p>
        <h1>{t('privacy_page_title')}</h1>
        <p>{t('privacy_page_subtitle')}</p>
        <p className="privacy-last-update">
          <strong>{t('privacy_last_updated_label')}</strong> {t('privacy_last_updated_value')}
        </p>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_controller_title')}</h2>
        <ul>
          {controllerLines.map((item, index) => (
            <li key={`controller-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_dpo_title')}</h2>
        <ul>
          {dpoLines.map((item, index) => (
            <li key={`dpo-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_processing_title')}</h2>
        <ul>
          {processingPoints.map((item, index) => (
            <li key={`processing-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_legal_basis_title')}</h2>
        <ul>
          {legalBasisPoints.map((item, index) => (
            <li key={`legal-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_recipients_title')}</h2>
        <ul>
          {recipientsPoints.map((item, index) => (
            <li key={`recipients-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_storage_title')}</h2>
        <ul>
          {storagePoints.map((item, index) => (
            <li key={`storage-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_ai_title')}</h2>
        <ul>
          {aiPoints.map((item, index) => (
            <li key={`ai-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_rights_title')}</h2>
        <ul>
          {rightsPoints.map((item, index) => (
            <li key={`rights-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_contact_title')}</h2>
        <ul>
          {contactPoints.map((item, index) => (
            <li key={`contact-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-section">
        <h2>{t('privacy_section_sources_title')}</h2>
        <p>{t('privacy_sources_intro')}</p>
        <ul>
          <li>
            <a href="https://www.otterbach-otterberg.de/service/datenschutz" target="_blank" rel="noopener noreferrer">
              {t('privacy_source_policy')}
            </a>
          </li>
          <li>
            <a
              href="https://www.otterbach-otterberg.de/service/datenschutz/informationen-gemaess-art-13-und-14-ds-gvo/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('privacy_source_art13')}
            </a>
          </li>
        </ul>
      </section>

      <div className="privacy-bottom-actions">
        <Link to="/" className="privacy-back-btn">
          <i className="fa-solid fa-arrow-left" /> {t('privacy_back_to_form')}
        </Link>
      </div>
    </main>
  );
};

export default Privacy;
