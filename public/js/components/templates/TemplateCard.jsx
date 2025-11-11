/**
 * Template Card Component
 * Displays a single template with actions
 */

import React from 'react';

const TemplateCard = ({ template, onEdit, onSetDefault, onDelete }) => {
    const lastUsed = template.last_used_date
        ? new Date(template.last_used_date).toLocaleDateString()
        : 'Never';

    return (
        <div className={`template-card ${template.is_default ? 'default' : ''}`}>
            <div className="template-card-header">
                <div className="template-title">
                    <h4>{template.template_name}</h4>
                </div>
                <div className="template-badges">
                    {template.is_default && (
                        <span className="badge default">
                            <i className="fas fa-star"></i> Default
                        </span>
                    )}
                    {template.is_active ? (
                        <span className="badge active">
                            <i className="fas fa-check"></i> Active
                        </span>
                    ) : (
                        <span className="badge inactive">
                            <i className="fas fa-times"></i> Inactive
                        </span>
                    )}
                    {template.is_system && (
                        <span className="badge system">
                            <i className="fas fa-shield-alt"></i> System
                        </span>
                    )}
                </div>
                <div className="template-meta">
                    <div className="meta-item">
                        <i className="fas fa-file"></i>
                        <span>{template.template_file_path || 'No file'}</span>
                    </div>
                    <div className="meta-item">
                        <i className="fas fa-clock"></i>
                        <span>Last used: {lastUsed}</span>
                    </div>
                    <div className="meta-item">
                        <i className="fas fa-user"></i>
                        <span>Created by: {template.created_by || 'Unknown'}</span>
                    </div>
                </div>
            </div>
            <div className="template-card-body">
                {template.description && (
                    <p className="template-description">{template.description}</p>
                )}
                <div className="template-actions">
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onEdit(template.template_id)}
                    >
                        <i className="fas fa-edit"></i> Edit Design
                    </button>
                    {!template.is_default && (
                        <button
                            className="btn btn-sm btn-success"
                            onClick={() => onSetDefault(template.template_id)}
                        >
                            <i className="fas fa-star"></i> Set Default
                        </button>
                    )}
                    {!template.is_system && (
                        <button
                            className="btn btn-sm btn-danger"
                            onClick={() => onDelete(template.template_id, template.template_name)}
                        >
                            <i className="fas fa-trash"></i> Delete
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TemplateCard;
