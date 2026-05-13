import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, message, Descriptions, Tag } from 'antd';
import { useAuth } from '../AuthContext';
import axios from 'axios';

export default function Profile() {
  const { user, logout } = useAuth();
  const [form] = Form.useForm();
  const [weightInfo, setWeightInfo] = useState({ professional_weight: null, assessment_completed: false });

  useEffect(() => {
    fetchWeight();
  }, []);

  const fetchWeight = async () => {
    try {
      const res = await axios.get('/api/user/weight');
      setWeightInfo(res.data);
    } catch (err) {
      console.error('获取权重失败', err);
    }
  };

  const handleChangePassword = async (values) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    try {
      await axios.post('/api/change-password', {
        old_password: values.oldPassword,
        new_password: values.newPassword,
      });
      message.success('密码修改成功，请重新登录');
      logout();
    } catch (err) {
      message.error(err.response?.data?.detail || '修改失败，请检查原密码');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="账号信息">
        <Descriptions column={1} bordered>
          <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="角色">{user?.username === 'admin' ? '管理员' : '普通用户'}</Descriptions.Item>
          <Descriptions.Item label="专业权重">
            {weightInfo.professional_weight !== null ? (
              <Tag color="blue">{weightInfo.professional_weight}%</Tag>
            ) : (
              <Tag color="orange">未测评</Tag>
            )}
            {weightInfo.assessment_completed ? (
              <span style={{ marginLeft: 8, color: '#52c41a' }}>（已测评）</span>
            ) : (
              <span style={{ marginLeft: 8, color: '#ff4d4f' }}>（未测评）</span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="权重说明">
            权重越高，您对代码质量的评分在高质量案例库中的占比越高。
            {weightInfo.professional_weight === 100 && <span> 您拥有最高权重（100%），您的评分将完全决定案例质量分。</span>}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="修改密码" style={{ marginTop: 24 }}>
        <Form form={form} onFinish={handleChangePassword} layout="vertical">
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">修改密码</Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}