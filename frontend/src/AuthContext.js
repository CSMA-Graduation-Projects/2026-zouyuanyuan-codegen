import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assessmentCompleted, setAssessmentCompleted] = useState(false);
  const [professionalWeight, setProfessionalWeight] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setUser({ token, username });
      // 获取用户测评状态
      axios.get('/api/assessment/status')
        .then(res => {
          setAssessmentCompleted(res.data.completed);
          setProfessionalWeight(res.data.professional_weight);
        })
        .catch(() => {});
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const res = await axios.post('/api/login', { username, password });
    const { access_token } = res.data;
    localStorage.setItem('token', access_token);
    localStorage.setItem('username', username);
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    setUser({ token: access_token, username });
    // 获取测评状态
    const statusRes = await axios.get('/api/assessment/status');
    setAssessmentCompleted(statusRes.data.completed);
    setProfessionalWeight(statusRes.data.professional_weight);
    return true;
  };

  const register = async (username, password) => {
    const res = await axios.post('/api/register', { username, password });
    const { access_token } = res.data;
    localStorage.setItem('token', access_token);
    localStorage.setItem('username', username);
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    setUser({ token: access_token, username });
    setAssessmentCompleted(false);
    setProfessionalWeight(null);
    return true;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
    setAssessmentCompleted(false);
    setProfessionalWeight(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, assessmentCompleted, professionalWeight }}>
      {children}
    </AuthContext.Provider>
  );
}