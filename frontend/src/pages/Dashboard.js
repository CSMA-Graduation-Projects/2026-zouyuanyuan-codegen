import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Typography, Spin } from 'antd';
import { UserOutlined, CodeOutlined, FileTextOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../AuthContext';

const { Title, Paragraph } = Typography;

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ totalSessions: 0, totalCodeGen: 0, loading: true });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get('/api/stats');
        setStats({ ...res.data, loading: false });
      } catch {
        setStats({ totalSessions: 0, totalCodeGen: 0, loading: false });
      }
    };
    fetchStats();
  }, [user]);

  if (stats.loading) return <Spin size="large" style={{ margin: 100 }} />;

  return (
    <div style={{ padding: 24 }}>
      <Title level={2}>欢迎回来，{user?.username || '用户'}！</Title>
      <Paragraph>交互式需求澄清与智能代码生成系统。以下数据均来自真实记录。</Paragraph>
      <Row gutter={16} style={{ marginTop: 24 }}>
        <Col span={12}><Card><Statistic title="我的会话总数" value={stats.totalSessions} prefix={<FileTextOutlined />} /></Card></Col>
        <Col span={12}><Card><Statistic title="高质量案例数" value={stats.totalCodeGen} prefix={<CodeOutlined />} /></Card></Col>
      </Row>
      <Card style={{ marginTop: 32 }} title="系统使用说明">
        <ul>
          <li>在「需求澄清助手」中输入自然语言需求，系统将自动识别模糊点并允许您增删改。</li>
          <li>确认模糊点后，进入多轮问答澄清，最终生成代码。</li>
          <li>生成的代码可以复制、保存到本地，并可标记为高质量案例。</li>
          <li>管理员可以配置模型和查看所有高质量案例。</li>
        </ul>
      </Card>
    </div>
  );
}