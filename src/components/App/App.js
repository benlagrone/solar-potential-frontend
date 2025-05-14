import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Bar, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import UAParser from 'ua-parser-js';
import PrivacyPolicyModal from '../PrivacyPolicyModal/PrivacyPolicyModal';
import useUserData from '../../hooks/useUserData';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

function App() {
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '', country: '' });
  // const { userData, loading: userDataLoading, error: userDataError } = useUserData(address);
  const [systemSize, setSystemSize] = useState(7);
  const [panelEfficiency, setPanelEfficiency] = useState(0.20);
  const [electricityRate, setElectricityRate] = useState('');
  const [installationCost, setInstallationCost] = useState(3);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPrivacyPolicyOpen, setIsPrivacyPolicyOpen] = useState(false);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const handleCalculate = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError(null);
  setResult(null);

  const parser = new UAParser();
  const browserData = {
    userAgent: navigator.userAgent,
    // screenResolution: `${window.screen.width}x${window.screen.height}`,
    languagePreference: navigator.language, // Changed from 'language'
    // timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrerUrl: document.referrer, // Changed from 'referrer'
    deviceType: parser.getDevice().type || 'desktop',
    // userAgent: navigator.userAgent,
    browserName: parser.getBrowser().name,
    browserVersion: parser.getBrowser().version,
    osName: parser.getOS().name,
    osVersion: parser.getOS().version,
    // deviceType: parser.getDevice().type || 'desktop',
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    colorDepth: window.screen.colorDepth,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cookiesEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    referrerURL: document.referrer,
  };

  try {
    const userDataResponse = await axios.post('http://localhost:8000/api/user-data', {
      address,
      browserData
    });

    const addressGuid = userDataResponse.data.guid;

    const response = await axios.post('http://localhost:8000/api/solar-potential', {
      guid: addressGuid,
      system_size: systemSize,
      panel_efficiency: panelEfficiency,
      electricity_rate: parseFloat(electricityRate),
      installation_cost_per_watt: installationCost
    });

    setResult(response.data);
  } catch (err) {
    setError(err.response?.data?.detail || err.message || 'An error occurred');
  } finally {
    setLoading(false);
  }
};

  const calculateChartData = () => {
    if (!result) return null;

    const chartData = {
      labels: ['All Sky', 'Clear Sky'],
      datasets: [
        {
          label: 'Average Solar Radiation',
          data: [result.avg_all_sky_radiation, result.avg_clear_sky_radiation],
          backgroundColor: ['rgba(75, 192, 192, 0.6)', 'rgba(255, 159, 64, 0.6)'],
          borderColor: ['rgb(75, 192, 192)', 'rgb(255, 159, 64)'],
          borderWidth: 1,
        },
      ],
    };

    return chartData;
  };

  const calculateMonthlyChartData = () => {
    if (!result || !result.monthly_all_sky) return null;

    const monthlyChartData = {
      labels: monthNames,
      datasets: [
        {
          label: 'Monthly All Sky',
          data: Object.values(result.monthly_all_sky),
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.5)',
          fill: false,
        },
        {
          label: 'Monthly Clear Sky',
          data: Object.values(result.monthly_clear_sky),
          borderColor: 'rgb(255, 159, 64)',
          backgroundColor: 'rgba(255, 159, 64, 0.5)',
          fill: false,
        }
      ],
    };

    return monthlyChartData;
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'Solar Potential Comparison',
      },
    },
  };

  return (
    <div className="App">
      <h1>Solar Potential Calculator</h1>
      <form onSubmit={handleCalculate}>
        <input
          type="text"
          value={address.street}
          onChange={(e) => setAddress({ ...address, street: e.target.value })}
          placeholder="Enter street address"
          required
        />
        <input
          type="text"
          value={address.city}
          onChange={(e) => setAddress({ ...address, city: e.target.value })}
          placeholder="Enter city"
          required
        />
        <input
          type="text"
          value={address.state}
          onChange={(e) => setAddress({ ...address, state: e.target.value })}
          placeholder="Enter state"
          required
        />
        <input
          type="text"
          value={address.zip}
          onChange={(e) => setAddress({ ...address, zip: e.target.value })}
          placeholder="Enter zip code"
          required
        />
        <input
          type="text"
          value={address.country}
          onChange={(e) => setAddress({ ...address, country: e.target.value })}
          placeholder="Enter country"
          required
        />
        <input
          type="number"
          value={systemSize}
          onChange={(e) => setSystemSize(parseFloat(e.target.value))}
          placeholder="System size (kW)"
          required
        />
        <input
          type="number"
          value={panelEfficiency}
          onChange={(e) => setPanelEfficiency(parseFloat(e.target.value))}
          placeholder="Panel efficiency"
          step="0.01"
          required
        />
        <input
          type="number"
          value={electricityRate}
          onChange={(e) => setElectricityRate(e.target.value)}
          placeholder="Electricity rate ($/kWh)"
          step="0.01"
          required
        />
        <input
          type="number"
          value={installationCost}
          onChange={(e) => setInstallationCost(parseFloat(e.target.value))}
          placeholder="Installation cost ($/W)"
          step="0.01"
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Calculating...' : 'Calculate'}
        </button>
      </form>

      {loading && <p>Loading...</p>}
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="result">
          <h2>Solar Potential Results</h2>
          <p>Address: {result.address}</p>
          <p>Latitude: {result.latitude.toFixed(4)}</p>
          <p>Longitude: {result.longitude.toFixed(4)}</p>
          <p>Average All Sky Radiation: {result.avg_all_sky_radiation.toFixed(2)} {result.unit}</p>
          <p>Average Clear Sky Radiation: {result.avg_clear_sky_radiation.toFixed(2)} {result.unit}</p>
          <p>All Sky Data Quality: {result.all_sky_data_quality.toFixed(0)}%</p>
          <p>Clear Sky Data Quality: {result.clear_sky_data_quality.toFixed(0)}%</p>
          <p>Period: {result.period}</p>
          
          <h3>Best and Worst Case Scenarios</h3>
          <p>Best All Sky: {result.best_all_sky.toFixed(2)} {result.unit}</p>
          <p>Worst All Sky: {result.worst_all_sky.toFixed(2)} {result.unit}</p>
          <p>Best Clear Sky: {result.best_clear_sky.toFixed(2)} {result.unit}</p>
          <p>Worst Clear Sky: {result.worst_clear_sky.toFixed(2)} {result.unit}</p>

          <h3>Solar Panel System Calculations</h3>
          <p>Daily Energy Production: {result.daily_production.toFixed(2)} kWh</p>
          <p>Annual Energy Production: {result.annual_production.toFixed(2)} kWh</p>
          <p>Annual Savings: ${result.annual_savings.toFixed(2)}</p>
          <p>System Cost: ${result.system_cost.toFixed(2)}</p>
          <p>Payback Period: {result.payback_period.toFixed(1)} years</p>
          <p>25-Year Savings: ${result.total_savings_25_years.toFixed(2)}</p>

          <div className="chart-container">
            {calculateChartData() && <Bar data={calculateChartData()} options={chartOptions} />}
          </div>

          <h3>Monthly Averages</h3>
          <div className="chart-container">
            {calculateMonthlyChartData() && <Line data={calculateMonthlyChartData()} options={{...chartOptions, title: { display: true, text: 'Monthly Solar Radiation Averages' }}} />}
          </div>
          
          <div className="explanation">
            <h4>What does this mean?</h4>
            <p>The chart above shows the average solar radiation available at your location under two conditions, based on data from {result.period}:</p>
            <ul>
              <li><strong>All Sky:</strong> This represents the average solar energy available considering all weather conditions, including cloudy days. Your location receives an average of {result.avg_all_sky_radiation.toFixed(2)} {result.unit}.</li>
              <li><strong>Clear Sky:</strong> This represents the maximum solar energy available under ideal, cloudless conditions. Your location could receive up to {result.avg_clear_sky_radiation.toFixed(2)} {result.unit} under perfect conditions.</li>
            </ul>
            <p>The difference between these values indicates how much cloud cover typically affects solar energy potential in your area. A smaller difference suggests more consistent solar energy availability.</p>
            <p>Data quality: All Sky data is {result.all_sky_data_quality.toFixed(0)}% complete, Clear Sky data is {result.clear_sky_data_quality.toFixed(0)}% complete.</p>
            <p>Generally, locations with average daily radiation above 4 kWh/m²/day are considered good for solar power generation. Your location's all-sky average of {result.avg_all_sky_radiation.toFixed(2)} {result.unit} suggests {result.avg_all_sky_radiation > 4 ? 'good' : 'moderate'} potential for solar power.</p>
            
            <h4>Monthly Variations</h4>
            <p>The line chart shows how solar radiation varies throughout the year. This can help you understand seasonal changes in solar potential.</p>
            
            <h4>Best and Worst Case Scenarios</h4>
            <p>These values represent the highest and lowest daily solar radiation recorded in the period. They give you an idea of the range of solar potential in your area.</p>
            
            <h4>Solar Panel System</h4>
            <p>Based on a {systemSize}kW system with {(panelEfficiency * 100).toFixed(1)}% efficient panels:</p>
            <ul>
              <li>You could produce about {result.daily_production.toFixed(1)} kWh per day, or {result.annual_production.toFixed(0)} kWh per year.</li>
              <li>At your electricity rate of ${electricityRate}/kWh, this could save you ${result.annual_savings.toFixed(2)} per year.</li>
              <li>The system would cost about ${result.system_cost.toFixed(0)} to install.</li>
              <li>It would pay for itself in about {result.payback_period.toFixed(1)} years.</li>
              <li>Over 25 years, you could save approximately ${result.total_savings_25_years.toFixed(0)}.</li>
            </ul>
          </div>
        </div>
      )}


      <PrivacyPolicyModal 
      isOpen={isPrivacyPolicyOpen} 
      onClose={() => setIsPrivacyPolicyOpen(false)} />
      <button onClick={() => setIsPrivacyPolicyOpen(true)}>Privacy Policy</button>
    </div>
  );
}

export default App;