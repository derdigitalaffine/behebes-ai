import React, { useState } from 'react';
import { WorkflowStep } from '../../types/workflow';
import { useI18n } from '../../i18n/I18nProvider';
import './WorkflowStepReview.css';

interface WorkflowStepReviewProps {
  step: WorkflowStep;
  stepNumber: number;
  onEdit?: (updates: Partial<WorkflowStep>) => void;
}

const WorkflowStepReview: React.FC<WorkflowStepReviewProps> = ({
  step,
  stepNumber,
  onEdit,
}) => {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);

  const handleSave = () => {
    if (onEdit) {
      onEdit({ title, description });
    }
    setIsEditing(false);
  };

  const getStepTypeIcon = () => {
    switch (step.type) {
      case 'REDMINE_TICKET':
        return <i className="fa-solid fa-thumbtack" />;
      case 'EMAIL':
        return <i className="fa-solid fa-envelope" />;
      case 'CUSTOM':
        return <i className="fa-solid fa-gear" />;
      default:
        return <i className="fa-solid fa-clipboard-list" />;
    }
  };

  const getStepTypeLabel = () => {
    switch (step.type) {
      case 'REDMINE_TICKET':
        return t('workflow_step_type_redmine');
      case 'EMAIL':
        return t('workflow_step_type_email');
      case 'CUSTOM':
        return t('workflow_step_type_custom');
      default:
        return t('workflow_step_type_unknown');
    }
  };

  return (
    <div className="step-review-card">
      <div className="review-header">
        <div className="review-number">{stepNumber}</div>
        <div className="review-info">
          {!isEditing ? (
            <>
              <h4 className="review-title">{title}</h4>
              {description && <p className="review-description">{description}</p>}
            </>
          ) : (
            <div className="review-edit-form">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="review-input"
                placeholder={t('workflow_review_step_title_placeholder')}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="review-textarea"
                placeholder={t('workflow_review_step_description_placeholder')}
                rows={2}
              />
              <div className="review-edit-actions">
                <button
                  className="review-btn cancel-btn"
                  onClick={() => {
                    setTitle(step.title);
                    setDescription(step.description);
                    setIsEditing(false);
                  }}
                >
                  {t('workflow_action_cancel')}
                </button>
                <button
                  className="review-btn save-btn"
                  onClick={handleSave}
                >
                  {t('workflow_action_save')}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="review-type">
          <span className="type-badge">
            {getStepTypeIcon()} {getStepTypeLabel()}
          </span>
        </div>
      </div>

      {/* Step Configuration Display */}
      {step.config && Object.keys(step.config).length > 0 && (
        <div className="review-config">
          <h5>{t('workflow_review_config_title')}</h5>
          <ul className="config-list">
            {step.type === 'REDMINE_TICKET' && (
              <>
                {step.config.redmineProject && (
                  <li>
                    <span className="config-key">{t('workflow_review_config_project')}</span>
                    <span className="config-value">{step.config.redmineProject}</span>
                  </li>
                )}
                {step.config.redmineTracker && (
                  <li>
                    <span className="config-key">{t('workflow_review_config_tracker')}</span>
                    <span className="config-value">{step.config.redmineTracker}</span>
                  </li>
                )}
                {step.config.ticketTitle && (
                  <li>
                    <span className="config-key">{t('workflow_review_config_title_template')}</span>
                    <span className="config-value">{step.config.ticketTitle}</span>
                  </li>
                )}
              </>
            )}

            {step.type === 'EMAIL' && (
              <>
                {step.config.emailSubject && (
                  <li>
                    <span className="config-key">{t('workflow_review_config_subject')}</span>
                    <span className="config-value">{step.config.emailSubject}</span>
                  </li>
                )}
                {step.config.emailTo && step.config.emailTo.length > 0 && (
                  <li>
                    <span className="config-key">{t('workflow_review_config_recipients')}</span>
                    <span className="config-value">{step.config.emailTo.join(', ')}</span>
                  </li>
                )}
                {step.config.includeAttachments && (
                  <li>
                    <span className="config-key">{t('workflow_review_config_attachments')}</span>
                    <span className="config-value"><i className="fa-solid fa-check" /> {t('workflow_review_config_yes')}</span>
                  </li>
                )}
              </>
            )}
          </ul>
        </div>
      )}

      {/* Edit Button */}
      {!isEditing && (
        <div className="review-actions">
          <button
            className="review-btn edit-btn"
            onClick={() => setIsEditing(true)}
          >
            <i className="fa-solid fa-pen" /> {t('workflow_action_edit')}
          </button>
        </div>
      )}
    </div>
  );
};

export default WorkflowStepReview;
