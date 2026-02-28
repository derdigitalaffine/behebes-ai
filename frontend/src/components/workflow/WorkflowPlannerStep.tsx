import React, { useState } from 'react';
import { WorkflowStep, StepType } from '../../types/workflow';
import { ActionButton, Alert } from '../FormComponents';
import { useI18n } from '../../i18n/I18nProvider';
import './WorkflowPlannerStep.css';

interface WorkflowPlannerStepProps {
  onAddStep: (step: WorkflowStep) => void;
  currentStepCount: number;
}

const WorkflowPlannerStep: React.FC<WorkflowPlannerStepProps> = ({
  onAddStep,
  currentStepCount,
}) => {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [stepType, setStepType] = useState<StepType>('REDMINE_TICKET');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Record<string, any>>({});

  const handleAddStep = () => {
    if (!title.trim()) {
      setError(t('workflow_planner_error_title'));
      return;
    }

    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      type: stepType,
      status: 'PENDING',
      config: config,
    };

    onAddStep(newStep);

    // Reset form
    setTitle('');
    setDescription('');
    setConfig({});
    setError('');
    setIsExpanded(false);
  };

  const handleStepTypeChange = (type: StepType) => {
    setStepType(type);
    setConfig({}); // Reset config when type changes
    setError('');
  };

  return (
    <div className="planner-step">
      <button
        className="planner-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>{isExpanded ? '−' : '+'} {t('workflow_planner_add_step')}</span>
      </button>

      {isExpanded && (
        <div className="planner-form">
          {error && (
            <Alert
              type="error"
              message={error}
              dismissible={true}
              onDismiss={() => setError('')}
            />
          )}

          {/* Step Type Selection */}
          <div className="form-group">
            <label className="form-label">{t('workflow_planner_step_type')}</label>
            <div className="type-selector">
              <label className="type-option">
                <input
                  type="radio"
                  value="REDMINE_TICKET"
                  checked={stepType === 'REDMINE_TICKET'}
                  onChange={(e) => handleStepTypeChange(e.target.value as StepType)}
                />
                <span><i className="fa-solid fa-thumbtack" /> {t('workflow_planner_type_redmine')}</span>
              </label>
              <label className="type-option">
                <input
                  type="radio"
                  value="EMAIL"
                  checked={stepType === 'EMAIL'}
                  onChange={(e) => handleStepTypeChange(e.target.value as StepType)}
                />
                <span><i className="fa-solid fa-envelope" /> {t('workflow_planner_type_email')}</span>
              </label>
              <label className="type-option">
                <input
                  type="radio"
                  value="CUSTOM"
                  checked={stepType === 'CUSTOM'}
                  onChange={(e) => handleStepTypeChange(e.target.value as StepType)}
                />
                <span><i className="fa-solid fa-gear" /> {t('workflow_planner_type_custom')}</span>
              </label>
            </div>
          </div>

          {/* Title */}
          <div className="form-group">
            <label htmlFor="step-title" className="form-label">
              {t('workflow_planner_title')}
            </label>
            <input
              id="step-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
              placeholder={`z.B. "${t(
                stepType === 'REDMINE_TICKET'
                  ? 'workflow_planner_title_placeholder_redmine'
                  : stepType === 'EMAIL'
                  ? 'workflow_planner_title_placeholder_email'
                  : 'workflow_planner_title_placeholder_custom'
              )}"`}
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="step-desc" className="form-label">
              {t('workflow_planner_description')}
            </label>
            <textarea
              id="step-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-textarea"
              placeholder={t('workflow_planner_description_placeholder')}
              rows={2}
            />
          </div>

          {/* Type-Specific Config */}
          {stepType === 'REDMINE_TICKET' && (
            <RedmineTicketConfig
              config={config}
              onChange={(newConfig) => setConfig(newConfig)}
            />
          )}

          {stepType === 'EMAIL' && (
            <EmailConfig
              config={config}
              onChange={(newConfig) => setConfig(newConfig)}
            />
          )}

          {/* Action Buttons */}
          <div className="planner-actions">
            <button
              className="planner-cancel-btn"
              onClick={() => {
                setIsExpanded(false);
                setTitle('');
                setDescription('');
                setConfig({});
                setError('');
              }}
            >
              {t('workflow_action_cancel')}
            </button>
            <ActionButton
              variant="success"
              onClick={handleAddStep}
            >
              <i className="fa-solid fa-plus" /> {t('workflow_planner_add_confirm')}
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
};

// Redmine Ticket Config Component
const RedmineTicketConfig: React.FC<{
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
}> = ({ config, onChange }) => {
  const { t } = useI18n();

  return (
    <div className="config-section">
      <h4>{t('workflow_planner_redmine_title')}</h4>

      <div className="form-group">
        <label htmlFor="redmine-project" className="form-label">
          {t('workflow_planner_redmine_project')}
        </label>
        <input
          id="redmine-project"
          type="text"
          value={config.redmineProject || ''}
          onChange={(e) => onChange({ ...config, redmineProject: e.target.value })}
          className="form-input"
          placeholder={t('workflow_planner_redmine_project_placeholder')}
        />
      </div>

      <div className="form-group">
        <label htmlFor="redmine-tracker" className="form-label">
          {t('workflow_planner_redmine_tracker')}
        </label>
        <input
          id="redmine-tracker"
          type="text"
          value={config.redmineTracker || ''}
          onChange={(e) => onChange({ ...config, redmineTracker: e.target.value })}
          className="form-input"
          placeholder={t('workflow_planner_redmine_tracker_placeholder')}
        />
      </div>

      <div className="form-group">
        <label htmlFor="ticket-title" className="form-label">
          {t('workflow_planner_ticket_title')}
        </label>
        <input
          id="ticket-title"
          type="text"
          value={config.ticketTitle || ''}
          onChange={(e) => onChange({ ...config, ticketTitle: e.target.value })}
          className="form-input"
          placeholder={t('workflow_planner_ticket_title_placeholder')}
        />
      </div>

      <div className="form-group">
        <label htmlFor="ticket-description" className="form-label">
          {t('workflow_planner_ticket_description')}
        </label>
        <textarea
          id="ticket-description"
          value={config.ticketDescription || ''}
          onChange={(e) => onChange({ ...config, ticketDescription: e.target.value })}
          className="form-textarea"
          placeholder={t('workflow_planner_ticket_description_placeholder')}
          rows={3}
        />
      </div>
    </div>
  );
};

// Email Config Component
const EmailConfig: React.FC<{
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
}> = ({ config, onChange }) => {
  const [emailInput, setEmailInput] = useState('');

  const handleAddEmail = () => {
    if (emailInput.trim() && emailInput.includes('@')) {
      const emails = config.emailTo || [];
      onChange({
        ...config,
        emailTo: [...emails, emailInput.trim()],
      });
      setEmailInput('');
    }
  };

  const { t } = useI18n();

  return (
    <div className="config-section">
      <h4>{t('workflow_planner_email_title')}</h4>

      <div className="form-group">
        <label htmlFor="email-subject" className="form-label">
          {t('workflow_planner_email_subject')}
        </label>
        <input
          id="email-subject"
          type="text"
          value={config.emailSubject || ''}
          onChange={(e) => onChange({ ...config, emailSubject: e.target.value })}
          className="form-input"
          placeholder={t('workflow_planner_email_subject_placeholder')}
        />
      </div>

      <div className="form-group">
        <label htmlFor="email-body" className="form-label">
          {t('workflow_planner_email_body')}
        </label>
        <textarea
          id="email-body"
          value={config.emailBody || ''}
          onChange={(e) => onChange({ ...config, emailBody: e.target.value })}
          className="form-textarea"
          placeholder={t('workflow_planner_email_body_placeholder')}
          rows={4}
        />
      </div>

      <div className="form-group">
        <label className="form-label">{t('workflow_planner_email_recipients')}</label>
        <div className="email-input-group">
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="form-input"
            placeholder={t('workflow_planner_email_placeholder')}
            onKeyPress={(e) => e.key === 'Enter' && handleAddEmail()}
          />
          <button
            className="email-add-btn"
            type="button"
            onClick={handleAddEmail}
          >
            +
          </button>
        </div>

        {config.emailTo && config.emailTo.length > 0 && (
          <div className="email-list">
            {config.emailTo.map((email: string, idx: number) => (
              <div key={idx} className="email-tag">
                {email}
                <button
                  onClick={() => {
                    onChange({
                      ...config,
                      emailTo: config.emailTo.filter((_: string, i: number) => i !== idx),
                    });
                  }}
                  className="email-remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.includeAttachments || false}
            onChange={(e) => onChange({ ...config, includeAttachments: e.target.checked })}
          />
          <span>{t('workflow_planner_email_attachments')}</span>
        </label>
      </div>
    </div>
  );
};

export default WorkflowPlannerStep;
