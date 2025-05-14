import { useState, useEffect } from 'react';
import axios from 'axios';
import UAParser from 'ua-parser-js';

const useUserData = (address) => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const parser = new UAParser();
        const browserData = {
          userAgent: navigator.userAgent,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          languagePreference: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          referrerUrl: document.referrer,
          deviceType: parser.getDevice().type || 'desktop'
        };

        const response = await axios.post('http://localhost:8000/api/user-data', {
          address,
          browserData
        });

        setUserData(response.data);
      } catch (err) {
        setError(err.message || 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [address]);

  return { userData, loading, error };
};

export default useUserData;