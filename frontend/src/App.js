import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import Login from './Login';
import Register from './Register';
import MainLayout from './Layout';
import Dashboard from './pages/Dashboard';
import CodeGen from './pages/CodeGen';
import History from './pages/History';
import Cases from './pages/Cases';
import Skills from './pages/Skills';
import Profile from './pages/Profile';
import Specifications from './pages/Specifications';
import ModelConfig from './pages/ModelConfig';
import UserManagement from './pages/UserManagement';
import Analysis from './pages/Analysis';
import Assessment from './pages/Assessment';
import { message } from 'antd';

// 管理员路由守卫
function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user || user.username !== 'admin') {
    message.error('您没有权限访问该页面');
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

// 测评路由守卫：如果用户未完成测评，强制跳转测评页
function AssessmentGuard({ children }) {
  const { user, assessmentCompleted, loading } = useAuth();
  if (loading) return <div>加载中...</div>;
  if (!user) return <Navigate to="/login" />;
  if (user && !assessmentCompleted) {
    return <Navigate to="/assessment" />;
  }
  return children;
}

function App() {
  const { user, loading } = useAuth();
  if (loading) return <div>加载中...</div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="codegen" element={<AssessmentGuard><CodeGen /></AssessmentGuard>} />
        <Route path="history" element={<AssessmentGuard><History /></AssessmentGuard>} />
        <Route path="profile" element={<AssessmentGuard><Profile /></AssessmentGuard>} />
        <Route path="cases" element={<AssessmentGuard><Cases /></AssessmentGuard>} />
        <Route path="skills" element={<AssessmentGuard><Skills /></AssessmentGuard>} />
        <Route path="specifications" element={<AssessmentGuard><Specifications /></AssessmentGuard>} />
        <Route path="analysis" element={<AssessmentGuard><Analysis /></AssessmentGuard>} />
        <Route path="model-config" element={<AdminRoute><ModelConfig /></AdminRoute>} />
        <Route path="user-management" element={<AdminRoute><UserManagement /></AdminRoute>} />
        <Route path="assessment" element={<Assessment />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" />} />
    </Routes>
  );
}

export default App;