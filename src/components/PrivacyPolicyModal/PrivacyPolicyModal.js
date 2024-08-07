import React, { useEffect, useState } from 'react';
import axios from 'axios';

const PrivacyPolicyModal = ({ isOpen, onClose }) => {
  const [privacyPolicy, setPrivacyPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      axios.get('http://localhost:8000/api/privacy-policy')
        .then(response => {
          setPrivacyPolicy(response.data);
          setLoading(false);
        })
        .catch(err => {
          setError(err.message || 'An error occurred');
          setLoading(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <span className="close" onClick={onClose}>&times;</span>
        {loading && <p>Loading...</p>}
        {error && <p className="error">{error}</p>}
        {privacyPolicy && (
          <div>
            <h2>Privacy Policy</h2>
            <p>{privacyPolicy}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivacyPolicyModal;