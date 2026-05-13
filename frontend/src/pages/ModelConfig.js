import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Switch, message, Popconfirm, Space } from 'antd';
import { EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../AuthContext';

export default function ModelConfig() {
  const { user } = useAuth();
  const [models, setModels] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [form] = Form.useForm();
  const isAdmin = user?.username === 'admin';

  const fetchModels = async () => {
    try {
      const res = await axios.get('/api/model_configs');
      setModels(res.data);
    } catch (err) {
      message.error('获取模型配置失败');
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleSave = async (values) => {
    try {
      if (editingModel) {
        await axios.put(`/api/model_configs/${editingModel.name}`, values);
        message.success('更新成功');
      } else {
        await axios.post('/api/model_configs', values);
        message.success('创建成功');
      }
      setModalVisible(false);
      setEditingModel(null);
      fetchModels();
    } catch (err) {
      message.error(err.response?.data?.detail || '保存失败');
    }
  };

  const handleDelete = async (name) => {
    try {
      await axios.delete(`/api/model_configs/${name}`);
      message.success('删除成功');
      fetchModels();
    } catch (err) {
      message.error(err.response?.data?.detail || '删除失败');
    }
  };

  const handleToggleActive = async (record) => {
    const newActive = !record.is_active;
    try {
      await axios.put(`/api/model_configs/${record.name}`, {
        ...record,
        is_active: newActive,
      });
      message.success(`${record.name} 已${newActive ? '启用' : '停用'}`);
      fetchModels();
    } catch (err) {
      message.error('操作失败');
    }
  };

  const columns = [
    { title: '模型名称', dataIndex: 'name' },
    { title: 'API Base URL', dataIndex: 'api_base', ellipsis: true },
    { 
      title: '状态', 
      dataIndex: 'is_active', 
      render: (v, record) => (
        <Switch
          checked={v}
          onChange={() => handleToggleActive(record)}
          checkedChildren="启用"
          unCheckedChildren="停用"
        />
      )
    },
    ...(isAdmin ? [{
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button 
            icon={<EditOutlined />} 
            onClick={() => { 
              setEditingModel(record); 
              form.setFieldsValue(record); 
              setModalVisible(true); 
            }}
          >
            编辑
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.name)}>
            <Button icon={<DeleteOutlined />} danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }] : [])
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card 
        title="模型配置管理" 
        extra={isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingModel(null); form.resetFields(); setModalVisible(true); }}>新增模型</Button>}
      >
        <Table dataSource={models} columns={columns} rowKey="name" />
      </Card>
      {isAdmin && (
        <Modal 
          title={editingModel ? "编辑模型" : "新增模型"} 
          open={modalVisible} 
          onCancel={() => { setModalVisible(false); setEditingModel(null); }}
          footer={null}
        >
          <Form form={form} onFinish={handleSave} layout="vertical" initialValues={{ is_active: true }}>
            <Form.Item name="name" label="模型名称（标识）" rules={[{ required: true }]}>
              <Input disabled={!!editingModel} placeholder="例如: deepseek, doubao, qwen, gpt-4" />
            </Form.Item>
            <Form.Item name="api_key" label="API Key" rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="api_base" label="API Base URL">
              <Input placeholder="可选，默认使用官方地址" />
            </Form.Item>
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">保存</Button>
            </Form.Item>
          </Form>
        </Modal>
      )}
    </div>
  );
}