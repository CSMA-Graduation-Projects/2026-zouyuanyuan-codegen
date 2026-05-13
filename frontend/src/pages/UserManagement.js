import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Switch, message, Popconfirm, Space, InputNumber, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined, SaveOutlined } from '@ant-design/icons';
import axios from 'axios';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [resetPwdModalVisible, setResetPwdModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [resetUserId, setResetUserId] = useState(null);
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();
  const [updatingWeight, setUpdatingWeight] = useState(null); // 正在更新权重的用户ID

  const fetchUsers = async () => {
    try {
      const res = await axios.get('/api/admin/users');
      setUsers(res.data);
    } catch (err) {
      message.error('获取用户列表失败');
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSave = async (values) => {
    try {
      if (editingUser) {
        await axios.put(`/api/admin/users/${editingUser.id}`, {
          username: values.username,
          is_admin: values.is_admin,
        });
        message.success('更新成功');
      } else {
        await axios.post('/api/admin/users', {
          username: values.username,
          password: values.password,
          is_admin: values.is_admin,
        });
        message.success('创建成功');
      }
      setModalVisible(false);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.detail || '操作失败');
    }
  };

  const handleDelete = async (user) => {
    if (user.username === 'admin') {
      message.error('不能删除默认管理员账号');
      return;
    }
    try {
      await axios.delete(`/api/admin/users/${user.id}`);
      message.success('删除成功');
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.detail || '删除失败');
    }
  };

  const handleResetPassword = async () => {
    try {
      const values = await resetForm.validateFields();
      await axios.post(`/api/admin/users/${resetUserId}/reset-password`, {
        new_password: values.new_password,
      });
      message.success('密码重置成功');
      setResetPwdModalVisible(false);
      resetForm.resetFields();
    } catch (err) {
      message.error(err.response?.data?.detail || '重置失败');
    }
  };

  // 内联修改权重
  const updateWeight = async (userId, newWeight) => {
    if (newWeight === undefined || newWeight === null) return;
    if (newWeight < 0 || newWeight > 100) {
      message.error('权重必须在 0-100 之间');
      return;
    }
    setUpdatingWeight(userId);
    try {
      await axios.put(`/api/admin/users/${userId}/weight`, { professional_weight: newWeight });
      message.success('权重已更新');
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.detail || '设置失败');
    } finally {
      setUpdatingWeight(null);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username' },
    { title: '管理员', dataIndex: 'is_admin', render: (v) => (v ? '是' : '否') },
    {
      title: '专业权重',
      dataIndex: 'professional_weight',
      width: 180,
      render: (weight, record) => (
        <Space>
          <InputNumber
            min={0}
            max={100}
            value={weight !== null && weight !== undefined ? weight : 0}
            onChange={(value) => updateWeight(record.id, value)}
            disabled={updatingWeight === record.id}
            style={{ width: 80 }}
            placeholder="0-100"
          />
          <span style={{ marginLeft: 8, color: '#888' }}>%</span>
          {updatingWeight === record.id && <span style={{ color: '#1890ff' }}>保存中...</span>}
          <Tooltip title="权重越高，该用户评分在高质量案例中的占比越高。0% 完全使用系统评分，100% 完全使用用户评分。">
            <span style={{ cursor: 'help', color: '#999' }}>ⓘ</span>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '测评状态',
      dataIndex: 'assessment_completed',
      width: 100,
      render: (v) => (v ? '已完成' : '未测评'),
    },
    {
      title: '操作',
      width: 320,
      render: (_, record) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              setEditingUser(record);
              form.setFieldsValue({
                username: record.username,
                is_admin: record.is_admin,
              });
              setModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Button
            icon={<KeyOutlined />}
            onClick={() => {
              setResetUserId(record.id);
              setResetPwdModalVisible(true);
            }}
          >
            重置密码
          </Button>
          <Popconfirm
            title="确定删除该用户？"
            onConfirm={() => handleDelete(record)}
            okText="确定"
            cancelText="取消"
          >
            <Button icon={<DeleteOutlined />} danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="用户管理"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingUser(null);
              form.resetFields();
              setModalVisible(true);
            }}
          >
            新增用户
          </Button>
        }
      >
        <Table dataSource={users} columns={columns} rowKey="id" />
      </Card>

      {/* 编辑/新增用户模态框 */}
      <Modal
        title={editingUser ? "编辑用户" : "新增用户"}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input />
          </Form.Item>
          {!editingUser && (
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少6位' }]}
            >
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="is_admin" label="管理员" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码模态框 */}
      <Modal
        title="重置密码"
        open={resetPwdModalVisible}
        onCancel={() => setResetPwdModalVisible(false)}
        onOk={handleResetPassword}
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码至少6位' }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}