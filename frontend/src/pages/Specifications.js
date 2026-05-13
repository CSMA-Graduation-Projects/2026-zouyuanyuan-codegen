import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, message, Space, Input, Form, Spin, Popconfirm, InputNumber } from 'antd';
import { SaveOutlined, EyeOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../AuthContext';

const { TextArea } = Input;

export default function Specifications() {
  const { user } = useAuth();  // 添加这一行，从 AuthContext 获取 user
  const [docs, setDocs] = useState([]);
  const [filteredDocs, setFilteredDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);
  const [currentDoc, setCurrentDoc] = useState(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    fetchDocs();
  }, [user]);  // 依赖 user，切换用户时重新加载

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/spec_documents');
      if (res.data && Array.isArray(res.data)) {
        setDocs(res.data);
        setFilteredDocs(res.data);
      } else {
        setDocs([]);
        setFilteredDocs([]);
        message.warning('获取规格说明书数据格式异常');
      }
    } catch (err) {
      console.error('获取规格说明书失败', err);
      message.error('获取规格说明书失败：' + (err.response?.data?.detail || err.message));
      setDocs([]);
      setFilteredDocs([]);
    } finally {
      setLoading(false);
    }
  };

  const saveSpec = async (sessionId, title, clarifiedSpec) => {
    try {
      await axios.post('/api/spec_documents', { session_id: sessionId, title, clarified_spec: clarifiedSpec });
      message.success('保存成功');
      fetchDocs();
    } catch (err) {
      console.error('保存失败', err);
      message.error('保存失败：' + (err.response?.data?.detail || err.message));
    }
  };

  const handleEdit = (doc) => {
    setCurrentDoc(doc);
    editForm.setFieldsValue({
      title: doc.title,
      clarified_spec: JSON.stringify(doc.clarified_spec, null, 2)
    });
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields();
      let parsedSpec;
      try {
        parsedSpec = JSON.parse(values.clarified_spec);
      } catch (e) {
        message.error('澄清规格 JSON 格式错误');
        return;
      }
      await saveSpec(currentDoc.session_id, values.title, parsedSpec);
      setEditModalVisible(false);
    } catch (err) {
      // 表单验证失败不处理
    }
  };

  const handleDelete = async (docId) => {
    try {
      await axios.delete(`/api/spec_documents/${docId}`);
      message.success('删除成功');
      fetchDocs();
    } catch (err) {
      message.error(err.response?.data?.detail || '删除失败');
    }
  };

  const handleSearch = (value) => {
    setSearchText(value);
    if (!value.trim()) {
      setFilteredDocs(docs);
    } else {
      const lowercasedValue = value.toLowerCase();
      const filtered = docs.filter(item =>
        (item.title && item.title.toLowerCase().includes(lowercasedValue)) ||
        (item.original_requirement && item.original_requirement.toLowerCase().includes(lowercasedValue))
      );
      setFilteredDocs(filtered);
    }
  };

  const columns = [
    { title: '会话ID', dataIndex: 'session_id', ellipsis: true },
    { title: '标题', dataIndex: 'title' },
    {
      title: '操作',
      render: (_, rec) => (
        <Space>
          <Button icon={<EyeOutlined />} onClick={() => { setCurrentDoc(rec); setVisible(true); }}>查看</Button>
          <Button icon={<EditOutlined />} onClick={() => handleEdit(rec)}>编辑</Button>
          <Popconfirm
            title="确定删除该规格说明书？"
            onConfirm={() => handleDelete(rec.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button icon={<DeleteOutlined />} danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (loading) return <Spin size="large" style={{ margin: 50 }} />;

  return (
    <div style={{ padding: 24 }}>
      <Card title="需求规格说明书管理" extra={
        <Input.Search
          placeholder="搜索标题或原始需求"
          allowClear
          onSearch={handleSearch}
          style={{ width: 300 }}
          prefix={<SearchOutlined />}
        />
      }>
        {filteredDocs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 50, color: '#999' }}>
            {searchText ? '没有找到匹配的规格说明书' : '暂无规格说明书'}
          </div>
        ) : (
          <Table dataSource={filteredDocs} columns={columns} rowKey="id" pagination={{ pageSize: 10 }} />
        )}
      </Card>

      <Modal open={visible} onCancel={() => setVisible(false)} footer={null} width={800} title="规格说明书">
        {currentDoc && (
          <>
            <h3>标题：{currentDoc.title}</h3>
            <h4>原始需求</h4>
            <p>{currentDoc.original_requirement}</p>
            <h4>澄清规格</h4>
            <pre style={{ background: 'white', color: 'black' }}>
              {JSON.stringify(currentDoc.clarified_spec, null, 2)}
            </pre>
          </>
        )}
      </Modal>

      <Modal
        title="编辑规格说明书"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleSaveEdit}
        width={800}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="clarified_spec" label="澄清规格（JSON格式）" rules={[{ required: true }]}>
            <TextArea rows={15} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}