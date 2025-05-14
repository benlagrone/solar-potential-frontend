import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Modal from 'react-modal';

const customStyles = {
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '500px',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)'
  }
};

Modal.setAppElement('#root');

const PrivacyPolicyModal = ({ isOpen, onClose }) => {
  const [privacyPolicy, setPrivacyPolicy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      axios.get('http://localhost:8000/api/privacy-policy')
        .then(response => {
          setPrivacyPolicy(response.data.policyText);
          setLoading(false);
        })
        .catch(err => {
          setError(err.message || 'An error occurred');
          setLoading(false);
        });
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      style={customStyles}
      contentLabel="Privacy Policy Modal"
    >
      <h2>Privacy Policy</h2>
      {loading && <p>Loading...</p>}
      {error && <p className="error">{error}</p>}
      {privacyPolicy && <div dangerouslySetInnerHTML={{ __html: privacyPolicy }} />}
      <button onClick={onClose}>Close</button>
    </Modal>
  );
};

export default PrivacyPolicyModal;