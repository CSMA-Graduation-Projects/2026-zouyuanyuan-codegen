import React, { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Button } from 'antd';
import { 
  DashboardOutlined, MessageOutlined, HistoryOutlined, 
  StarOutlined, FormOutlined, UserOutlined, LogoutOutlined,
  FileTextOutlined, SettingOutlined, TeamOutlined, BarChartOutlined,
  AppstoreOutlined, DatabaseOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import logo from './assets/logo.png';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = user?.username === 'admin';

  // 菜单定义
  const homeItem = { key: '/dashboard', icon: <DashboardOutlined />, label: '首页' };
  const coreItems = [
    { key: '/codegen', icon: <MessageOutlined />, label: '需求澄清助手' },
    { key: '/history', icon: <HistoryOutlined />, label: '历史任务' },
    { key: '/specifications', icon: <FileTextOutlined />, label: '规格说明书' },
  ];
  const analysisItems = [
    { key: '/analysis', icon: <BarChartOutlined />, label: '代码分析' },
    { key: '/cases', icon: <StarOutlined />, label: '高质量案例' },
  ];
  const systemItems = [
    // 技能管理已移到核心功能或数据分析组，此处不再重复
    { key: '/profile', icon: <UserOutlined />, label: '账号管理' },
    ...(isAdmin ? [{ key: '/model-config', icon: <SettingOutlined />, label: '模型配置' }] : []),
    ...(isAdmin ? [{ key: '/user-management', icon: <TeamOutlined />, label: '用户管理' }] : []),
  ];

  // 将技能管理单独放在一个显眼位置，所有用户可见
  const skillItem = { key: '/skills', icon: <ThunderboltOutlined />, label: '技能管理' };

  const menuItems = [
    homeItem,
    { key: 'core-group', icon: <AppstoreOutlined />, label: '核心功能', children: coreItems, type: 'group' },
    skillItem,   // 直接添加到一级菜单，便于访问
    { key: 'analysis-group', icon: <DatabaseOutlined />, label: '数据分析', children: analysisItems, type: 'group' },
    { key: 'system-group', icon: <SettingOutlined />, label: '系统设置', children: systemItems, type: 'group' },
  ];

  const userMenu = {
    items: [
      { key: 'profile', label: '个人中心', icon: <UserOutlined />, onClick: () => navigate('/profile') },
      { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, onClick: () => { logout(); navigate('/login'); } },
    ],
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 顶部 Header：只保留 Logo、标题和用户信息，无折叠按钮 */}
      <Header style={{
        background: '#fff',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #f0f0f0',
        position: 'fixed',
        top: 0,
        right: 0,
        left: 0,
        zIndex: 1000,
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={logo} alt="logo" style={{ width: 32, height: 32, marginRight: 8 }} />
          <Text strong style={{ fontSize: 18 }}>智能代码生成系统</Text>
        </div>
        <Dropdown menu={userMenu} placement="bottomRight">
          <Space style={{ cursor: 'pointer' }}>
            <Avatar icon={<UserOutlined />} />
            <Text>{user?.username || '用户'}</Text>
          </Space>
        </Dropdown>
      </Header>

      {/* 主体区域：侧边栏 + 内容区 */}
      <Layout style={{ marginTop: 64, minHeight: 'calc(100vh - 64px)' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="light"
          width={200}
          collapsedWidth={48}
          trigger={null}
          style={{ 
            position: 'fixed', 
            left: 0, 
            top: 64, 
            bottom: 0, 
            overflow: 'auto', 
            zIndex: 999, 
            display: 'flex', 
            flexDirection: 'column' 
          }}
        >
          <div style={{ flex: 1 }}>
            <Menu
              mode="inline"
              selectedKeys={[location.pathname]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              style={{ borderRight: 0 }}
            />
          </div>
          <div style={{ padding: '16px', textAlign: 'center', borderTop: '1px solid #f0f0f0' }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ width: '100%' }}
            />
          </div>
        </Sider>
        <Layout style={{ marginLeft: collapsed ? 48 : 200, transition: 'margin-left 0.2s' }}>
          <Content style={{ margin: '24px', background: '#f0f2f5', minHeight: 'calc(100vh - 112px)' }}>
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}