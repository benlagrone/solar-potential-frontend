import React, { useState } from 'react';
import axios from 'axios';
import { Bar, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import './App.css';
import UAParser from 'ua-parser-js';
import PrivacyPolicyModal from '../PrivacyPolicyModal/PrivacyPolicyModal';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

function App() {
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '', country: '' });
  const [systemSize, setSystemSize] = useState(7);
  const [panelEfficiency, setPanelEfficiency] = useState(0.20);
  const [electricityRate, setElectricityRate] = useState('');
  const [installationCost, setInstallationCost] = useState(3);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPrivacyPolicyOpen, setIsPrivacyPolicyOpen] = useState(false);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
  
    const parser = new UAParser();
    const browserData = {
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      languagePreference: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      referrerUrl: document.referrer,
      deviceType: parser.getDevice().type || 'desktop'
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

  const chartData = result && result.solar_data ? {
    labels: ['All Sky', 'Clear Sky'],
    datasets: [
      {
        label: 'Average Solar Radiation',
        data: [result.solar_data.avg_all_sky_radiation, result.solar_data.avg_clear_sky_radiation],
        backgroundColor: ['rgba(75, 192, 192, 0.6)', 'rgba(255, 159, 64, 0.6)'],
        borderColor: ['rgb(75, 192, 192)', 'rgb(255, 159, 64)'],
        borderWidth: 1,
      },
    ],
  } : null;

  const monthlyChartData = result && result.solar_data ? {
    labels: monthNames,
    datasets: [
      {
        label: 'Monthly All Sky',
        data: monthNames.map((_, index) => result.solar_data.monthly_all_sky?.[index + 1] ?? null),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
      },
      {
        label: 'Monthly Clear Sky',
        data: monthNames.map((_, index) => result.solar_data.monthly_clear_sky?.[index + 1] ?? null),
        borderColor: 'rgb(255, 159, 64)',
        backgroundColor: 'rgba(255, 159, 64, 0.5)',
      },
    ],
  } : null;

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
      <form onSubmit={handleSubmit}>
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
      {error && <p className="error">{typeof error === 'object' ? JSON.stringify(error) : error}</p>}
      {result && (
        <div className="result">
          <h2>Solar Potential Results</h2>
          <p>Address: {result.solar_data.address}</p>
          <p>Latitude: {result.solar_data.latitude}</p>
          <p>Longitude: {result.solar_data.longitude}</p>
          <p>Average All Sky Radiation: {result.solar_data.avg_all_sky_radiation?.toFixed(2)} {result.solar_data.unit}</p>
          <p>Average Clear Sky Radiation: {result.solar_data.avg_clear_sky_radiation?.toFixed(2)} {result.solar_data.unit}</p>
          <p>All Sky Data Quality: {result.solar_data.all_sky_data_quality?.toFixed(2)}%</p>
          <p>Clear Sky Data Quality: {result.solar_data.clear_sky_data_quality?.toFixed(2)}%</p>
          <p>Period: {result.solar_data.period}</p>
          
          <h3>Best and Worst Case Scenarios</h3>
          <p>Best All Sky: {result.solar_data.best_all_sky?.toFixed(2)} {result.solar_data.unit}</p>
          <p>Worst All Sky: {result.solar_data.worst_all_sky?.toFixed(2)} {result.solar_data.unit}</p>
          <p>Best Clear Sky: {result.solar_data.best_clear_sky?.toFixed(2)} {result.solar_data.unit}</p>
          <p>Worst Clear Sky: {result.solar_data.worst_clear_sky?.toFixed(2)} {result.solar_data.unit}</p>

          <h3>Solar Panel System Calculations</h3>
          <p>Daily Energy Production: {result.daily_production?.toFixed(2)} kWh</p>
          <p>Annual Energy Production: {result.annual_production?.toFixed(2)} kWh</p>
          <p>Annual Savings: ${result.annual_savings?.toFixed(2)}</p>
          <p>System Cost: ${result.system_cost?.toFixed(2)}</p>
          <p>Payback Period: {result.payback_period?.toFixed(1)} years</p>
          <p>25-Year Savings: ${result.total_savings_25_years?.toFixed(2)}</p>

          <div className="chart-container">
            {chartData && <Bar data={chartData} options={chartOptions} />}
          </div>

          <h3>Monthly Averages</h3>
          <div className="chart-container">
            {monthlyChartData && <Line data={monthlyChartData} options={{...chartOptions, title: { display: true, text: 'Monthly Solar Radiation Averages' }}} />}
          </div>
          
          <div className="explanation">
            <h4>What does this mean?</h4>
            <p>The chart above shows the average solar radiation available at your location under two conditions, based on data from {result.solar_data.period}:</p>
            <ul>
              <li><strong>All Sky:</strong> This represents the average solar energy available considering all weather conditions, including cloudy days. Your location receives an average of {result.solar_data.avg_all_sky_radiation?.toFixed(2)} {result.solar_data.unit}.</li>
              <li><strong>Clear Sky:</strong> This represents the maximum solar energy available under ideal, cloudless conditions. Your location could receive up to {result.solar_data.avg_clear_sky_radiation?.toFixed(2)} {result.solar_data.unit} under perfect conditions.</li>
            </ul>
            <p>The difference between these values indicates how much cloud cover typically affects solar energy potential in your area. A smaller difference suggests more consistent solar energy availability.</p>
            <p>Data quality: All Sky data is {result.solar_data.all_sky_data_quality?.toFixed(2)}% complete, Clear Sky data is {result.solar_data.clear_sky_data_quality?.toFixed(2)}% complete.</p>
            <p>Generally, locations with average daily radiation above 4 kWh/m²/day are considered good for solar power generation. Your location's all-sky average of {result.solar_data.avg_all_sky_radiation?.toFixed(2)} {result.solar_data.unit} suggests {result.solar_data.avg_all_sky_radiation > 4 ? 'good' : 'moderate'} potential for solar power.</p>
            
            <h4>Monthly Variations</h4>
            <p>The line chart shows how solar radiation varies throughout the year. This can help you understand seasonal changes in solar potential.</p>
            
            <h4>Best and Worst Case Scenarios</h4>
            <p>These values represent the highest and lowest daily solar radiation recorded in the 3-year period. They give you an idea of the range of solar potential in your area.</p>
            
            <h4>Solar Panel System</h4>
            <p>Based on a {systemSize}kW system with {(panelEfficiency * 100).toFixed(1)}% efficient panels:</p>
            <ul>
              <li>You could produce about {result.daily_production?.toFixed(1)} kWh per day, or {result.annual_production?.toFixed(0)} kWh per year.</li>
              <li>At your electricity rate of ${electricityRate}/kWh, this could save you ${result.annual_savings?.toFixed(2)} per year.</li>
              <li>The system would cost about ${result.system_cost?.toFixed(0)} to install.</li>
              <li>It would pay for itself in about {result.payback_period?.toFixed(1)} years.</li>
              <li>Over 25 years, you could save approximately ${result.total_savings_25_years?.toFixed(0)}.</li>
            </ul>
          </div>
        </div>
      )}
      <footer>
        <a href="#" onClick={() => setIsPrivacyPolicyOpen(true)}>Privacy Policy</a>
      </footer>
      <PrivacyPolicyModal isOpen={isPrivacyPolicyOpen} onClose={() => setIsPrivacyPolicyOpen(false)} />
    </div>
  );
}

export default App;