import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, message, Space, Tag, Input } from 'antd';
import { EyeOutlined, DeleteOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../AuthContext';

export default function Cases() {
  const { user } = useAuth();
  const [cases, setCases] = useState([]);
  const [filteredCases, setFilteredCases] = useState([]);
  const [previewCode, setPreviewCode] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    fetchCases();
  }, []);

  const fetchCases = async () => {
    try {
      const res = await axios.get('/api/cases');
      setCases(res.data);
      setFilteredCases(res.data);
    } catch (err) {
      message.error('获取案例失败');
    }
  };

  const deleteCase = async (id) => {
    if (!window.confirm('确定删除该案例？')) return;
    try {
      await axios.delete(`/api/cases/${id}`);
      message.success('删除成功');
      fetchCases();
    } catch (err) {
      message.error('删除失败');
    }
  };

  const saveCode = (code, filename = 'code.py') => {
    if (!code) return;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 搜索过滤
  const handleSearch = (value) => {
    setSearchText(value);
    if (!value.trim()) {
      setFilteredCases(cases);
    } else {
      const lowercasedValue = value.toLowerCase();
      const filtered = cases.filter(item =>
        item.requirement && item.requirement.toLowerCase().includes(lowercasedValue)
      );
      setFilteredCases(filtered);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '需求', dataIndex: 'requirement', ellipsis: true },
    { title: '模型', dataIndex: 'model_name', width: 100 },
    { title: '质量分', dataIndex: 'quality_score', width: 100, render: (v) => <Tag color={v>=85 ? 'green' : 'orange'}>{v}</Tag> },
    {
      title: '操作',
      width: 240,
      render: (_, record) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setPreviewCode(record.final_code); setModalVisible(true); }}>
            预览
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => saveCode(record.final_code, `case_${record.id}.py`)}>
            保存
          </Button>
          {user?.username === 'admin' && (
            <Button size="small" icon={<DeleteOutlined />} danger onClick={() => deleteCase(record.id)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card title="高质量案例库" extra={
        <Input.Search
          placeholder="搜索需求内容"
          allowClear
          onSearch={handleSearch}
          style={{ width: 250 }}
          prefix={<SearchOutlined />}
        />
      }>
        <div style={{ overflowX: 'auto' }}>
          <Table dataSource={filteredCases} columns={columns} rowKey="id" pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} />
        </div>
      </Card>
      <Modal title="代码预览" open={modalVisible} onCancel={() => setModalVisible(false)} footer={null} width={800}>
        <pre style={{ background: 'white', color: 'black', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 500 }}>{previewCode}</pre>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button icon={<DownloadOutlined />} onClick={() => saveCode(previewCode, 'preview_code.py')}>
            保存代码
          </Button>
        </div>
      </Modal>
    </div>
  );
}