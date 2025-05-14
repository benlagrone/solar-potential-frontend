import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
  headers: {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json'
  }
});

export const getUserData = (address, browserData) => {
  return api.post('/user-data', { address, browserData });
};

export const calculateSolarPotential = (data) => {
  return api.post('/solar-potential', data);
};

export const getPrivacyPolicy = () => {
  return api.get('/privacy-policy');
};