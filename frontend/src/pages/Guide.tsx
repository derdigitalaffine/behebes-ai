import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import './Guide.css';

const Guide: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();

  const goBackToForm = () => {
    navigate('/');
  };

  const quickstartCards = [
    {
      icon: 'fa-pen-to-square',
      title: t('guide_quickstart_card_1_title'),
      body: t('guide_quickstart_card_1_body'),
    },
    {
      icon: 'fa-camera',
      title: t('guide_quickstart_card_2_title'),
      body: t('guide_quickstart_card_2_body'),
    },
    {
      icon: 'fa-location-dot',
      title: t('guide_quickstart_card_3_title'),
      body: t('guide_quickstart_card_3_body'),
    },
    {
      icon: 'fa-envelope-open-text',
      title: t('guide_quickstart_card_4_title'),
      body: t('guide_quickstart_card_4_body'),
    },
  ];

  const processSteps = [
    t('guide_workflow_step_1'),
    t('guide_workflow_step_2'),
    t('guide_workflow_step_3'),
    t('guide_workflow_step_4'),
    t('guide_workflow_step_5'),
    t('guide_workflow_step_6'),
  ];

  const checklist = [
    t('guide_checklist_point_1'),
    t('guide_checklist_point_2'),
    t('guide_checklist_point_3'),
    t('guide_checklist_point_4'),
  ];

  const privacyPoints = [
    t('guide_privacy_point_1'),
    t('guide_privacy_point_2'),
    t('guide_privacy_point_3'),
    t('guide_privacy_point_4'),
    t('guide_privacy_point_5'),
    t('guide_privacy_point_6'),
  ];
  const magicLinkPoints = [
    t('guide_magic_link_point_1'),
    t('guide_magic_link_point_2'),
    t('guide_magic_link_point_3'),
    t('guide_magic_link_point_4'),
  ];

  const faqItems = [
    { q: t('guide_faq_q1'), a: t('guide_faq_a1') },
    { q: t('guide_faq_q2'), a: t('guide_faq_a2') },
    { q: t('guide_faq_q3'), a: t('guide_faq_a3') },
    { q: t('guide_faq_q4'), a: t('guide_faq_a4') },
  ];

  return (
    <main className="guide-page">
      <div className="guide-top-actions">
        <button type="button" className="guide-back-btn" onClick={goBackToForm}>
          <i className="fa-solid fa-arrow-left" /> {t('guide_back_to_form_cta')}
        </button>
      </div>

      <section className="guide-hero">
        <p className="guide-kicker">{t('guide_page_kicker')}</p>
        <h2>{t('guide_page_title')}</h2>
        <p>{t('guide_page_subtitle')}</p>
        <div className="guide-hero-chips">
          <span><i className="fa-solid fa-list-check" /> {t('guide_chip_guided')}</span>
          <span><i className="fa-solid fa-location-dot" /> {t('guide_chip_location')}</span>
          <span><i className="fa-solid fa-shield-check" /> {t('guide_chip_optin')}</span>
          <span><i className="fa-solid fa-key" /> {t('guide_chip_magic_link')}</span>
          <span><i className="fa-solid fa-envelope-open-text" /> {t('guide_chip_status')}</span>
        </div>
      </section>

      <section className="guide-section">
        <h3>{t('guide_quickstart_title')}</h3>
        <p>{t('guide_quickstart_intro')}</p>
        <div className="guide-card-grid">
          {quickstartCards.map((card, index) => (
            <article key={`quick-card-${index}`} className="guide-info-card">
              <div className="guide-info-icon">
                <i className={`fa-solid ${card.icon}`} />
              </div>
              <h4>{card.title}</h4>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-section guide-section-numbered">
        <h3>{t('guide_section_process_title')}</h3>
        <p>{t('guide_section_process_intro')}</p>
        <ol className="guide-timeline">
          {processSteps.map((step, index) => (
            <li key={`process-${index}`}>
              <span className="guide-timeline-index">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-section">
        <h3>{t('guide_section_without_location_title')}</h3>
        <ol>
          <li>{t('guide_without_location_point_1')}</li>
          <li>{t('guide_without_location_point_2')}</li>
          <li>{t('guide_without_location_point_3')}</li>
        </ol>
      </section>

      <section className="guide-section">
        <h3>{t('guide_section_checklist_title')}</h3>
        <ul>
          {checklist.map((item, index) => (
            <li key={`check-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="guide-section guide-section-numbered">
        <h3>{t('guide_section_start_title')}</h3>
        <ol>
          <li>{t('guide_start_step_1')}</li>
          <li>{t('guide_start_step_2')}</li>
          <li>{t('guide_start_step_3')}</li>
          <li>{t('guide_start_step_4')}</li>
          <li>{t('guide_start_step_5')}</li>
        </ol>
      </section>

      <section className="guide-section guide-section-numbered">
        <h3>{t('guide_section_status_title')}</h3>
        <ol>
          <li>{t('guide_status_step_1')}</li>
          <li>{t('guide_status_step_2')}</li>
          <li>{t('guide_status_step_3')}</li>
          <li>{t('guide_status_step_4')}</li>
        </ol>
      </section>

      <section className="guide-section guide-section-numbered">
        <h3>{t('guide_section_magic_link_title')}</h3>
        <ol>
          {magicLinkPoints.map((item, index) => (
            <li key={`magic-${index}`}>{item}</li>
          ))}
        </ol>
      </section>

      <section className="guide-section guide-section-numbered">
        <h3>{t('guide_section_privacy_title')}</h3>
        <ul>
          {privacyPoints.map((item, index) => (
            <li key={`privacy-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="guide-section guide-section-numbered">
        <h3>{t('guide_section_quality_title')}</h3>
        <ul>
          <li>{t('guide_quality_point_1')}</li>
          <li>{t('guide_quality_point_2')}</li>
          <li>{t('guide_quality_point_3')}</li>
          <li>{t('guide_quality_point_4')}</li>
        </ul>
      </section>

      <section className="guide-section guide-section-numbered">
        <h3>{t('guide_section_support_title')}</h3>
        <ul>
          <li>{t('guide_support_point_1')}</li>
          <li>{t('guide_support_point_2')}</li>
          <li>{t('guide_support_point_3')}</li>
        </ul>
      </section>

      <section className="guide-section">
        <h3>{t('guide_section_faq_title')}</h3>
        <div className="guide-faq-grid">
          {faqItems.map((item, index) => (
            <article key={`faq-${index}`} className="guide-faq-item">
              <h4>{item.q}</h4>
              <p>{item.a}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="guide-bottom-actions">
        <button type="button" className="guide-back-btn" onClick={goBackToForm}>
          <i className="fa-solid fa-arrow-left" /> {t('guide_back_to_form_cta')}
        </button>
      </div>
    </main>
  );
};

export default Guide;
