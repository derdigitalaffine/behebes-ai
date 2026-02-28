import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';

interface Category {
  id: string;
  name: string;
  description: string;
  assignedTo?: string;
  keywords?: string[];
  locked?: boolean;
  isSystemCategory?: boolean;
  externalRecipientEmail?: string;
  externalRecipientName?: string;
  processingMode?: 'internal' | 'external' | '';
}

interface Knowledge {
  version: string;
  categories: Category[];
  urgencies: any[];
}

const KnowledgeEditor: React.FC = () => {
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  const token = getAdminToken();

  useEffect(() => {
    fetchKnowledge();
  }, []);

  const fetchKnowledge = async () => {
    try {
      const response = await axios.get('/api/knowledge', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setKnowledge(response.data);
      setLoading(false);
    } catch (error) {
      setMessage('Fehler beim Laden der Kategorien');
      setMessageType('error');
      setLoading(false);
    }
  };

  const handleSaveCategory = async () => {
    if (!editingCategory) return;

    if (editingCategory.locked) {
      setMessage('Diese Kategorie ist geschützt und kann nicht bearbeitet werden');
      setMessageType('error');
      return;
    }

    setSaving(true);
    try {
      await axios.patch(`/api/knowledge/categories/${editingCategory.id}`, editingCategory, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessage('Kategorie erfolgreich aktualisiert');
      setMessageType('success');
      setEditingCategory(null);
      setTimeout(() => fetchKnowledge(), 1000);
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Fehler beim Speichern');
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Wirklich löschen?')) return;

    try {
      await axios.delete(`/api/knowledge/categories/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessage('Kategorie gelöscht');
      setMessageType('success');
      setTimeout(() => fetchKnowledge(), 1000);
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Fehler beim Löschen');
      setMessageType('error');
    }
  };


  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Kategorien Editor</h2>

      {message && (
        <div className={`message-banner p-4 rounded-lg flex items-center gap-2 ${messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {messageType === 'success' ? <i className="fa-solid fa-circle-check" /> : <i className="fa-solid fa-circle-exclamation" />}
          {message}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Kategorien</h3>
          <div className="space-y-3">
            {knowledge?.categories.map(cat => (
              <div key={cat.id} className="p-4 border border-gray-200 rounded-lg flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{cat.name}</h4>
                    {cat.locked && <i className="fa-solid fa-lock text-red-500" />}
                    {cat.isSystemCategory && <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">SYSTEM</span>}
                  </div>
                  <p className="text-sm text-gray-600">{cat.description}</p>
                </div>
                {!cat.locked && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setEditingCategory(cat); }}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded transition"
                    >
                      <i className="fa-solid fa-pen-to-square" />
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded transition"
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-96 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Kategorie bearbeiten</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={editingCategory.name}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Beschreibung</label>
                <textarea
                  value={editingCategory.description}
                  onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Zugeordnet zu</label>
                <input
                  type="text"
                  value={editingCategory.assignedTo || ''}
                  onChange={(e) => setEditingCategory({ ...editingCategory, assignedTo: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Externe Empfänger-Email</label>
                <input
                  type="email"
                  value={editingCategory.externalRecipientEmail || ''}
                  onChange={(e) => setEditingCategory({ ...editingCategory, externalRecipientEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Externer Empfänger (Name)</label>
                <input
                  type="text"
                  value={editingCategory.externalRecipientName || ''}
                  onChange={(e) => setEditingCategory({ ...editingCategory, externalRecipientName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Bearbeitung</label>
                <select
                  value={editingCategory.processingMode || ''}
                  onChange={(e) =>
                    setEditingCategory({
                      ...editingCategory,
                      processingMode: (e.target.value as 'internal' | 'external' | '') || '',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Nicht gesetzt</option>
                  <option value="internal">Intern</option>
                  <option value="external">Extern</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={handleSaveCategory}
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? (
                  <span><i className="fa-solid fa-spinner fa-spin" /> Speichern...</span>
                ) : (
                  <span><i className="fa-solid fa-floppy-disk" /> Speichern</span>
                )}
              </button>
              <button
                onClick={() => setEditingCategory(null)}
                className="btn btn-secondary"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeEditor;
