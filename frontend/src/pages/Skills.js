import React, { useState, useEffect } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Switch, InputNumber,
  Space, message, Popconfirm, Alert, Tabs, Tag, Tooltip, Row, Col,
  Transfer
} from 'antd';
import {
  EditOutlined, DeleteOutlined, PlusOutlined,
  ThunderboltOutlined, AppstoreOutlined, UnorderedListOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

const { TabPane } = Tabs;
const { TextArea } = Input;

export default function Skills() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // 模板管理状态
  const [templates, setTemplates] = useState([]);
  // 技能管理状态
  const [skills, setSkills] = useState([]);
  const [skillModalVisible, setSkillModalVisible] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [skillForm] = Form.useForm();
  const [skillTemplateIds, setSkillTemplateIds] = useState([]);      // 存储数字ID数组
  const [templateOptions, setTemplateOptions] = useState([]);       // Transfer 数据源，{ key: string, title: string }
  
  const [loading, setLoading] = useState(false);
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateForm] = Form.useForm();

  // 获取所有模板
  const fetchTemplates = async () => {
    try {
      const res = await axios.get('/api/templates');
      setTemplates(res.data);
      // 准备 Transfer 数据源，key 转为字符串
      const opts = res.data.map(t => ({ key: String(t.id), title: `${t.dimension}: ${t.question_text.substring(0, 50)}` }));
      setTemplateOptions(opts);
    } catch (err) {
      message.error('获取模板失败');
    }
  };

  // 获取技能列表
  const fetchSkills = async () => {
    try {
      const res = await axios.get('/api/skills');
      setSkills(res.data);
    } catch (err) {
      message.error('获取技能列表失败');
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchSkills();
  }, []);

  // ==================== 模板管理 CRUD ====================
  const handleSaveTemplate = async (values) => {
    try {
      if (editingTemplate) {
        await axios.put(`/api/templates/${editingTemplate.id}`, values);
        message.success('模板更新成功');
      } else {
        await axios.post('/api/templates', values);
        message.success('模板创建成功');
      }
      setTemplateModalVisible(false);
      fetchTemplates();
    } catch (err) {
      message.error('保存失败');
    }
  };

  const deleteTemplate = async (id) => {
    try {
      await axios.delete(`/api/templates/${id}`);
      message.success('删除成功');
      fetchTemplates();
    } catch (err) {
      message.error('删除失败');
    }
  };

  // ==================== 技能管理 CRUD ====================
  const openSkillModal = (skill = null) => {
    setEditingSkill(skill);
    if (skill) {
      skillForm.setFieldsValue({ name: skill.name, description: skill.description });
      // 确保 template_ids 是数字数组，转为字符串数组用于 Transfer
      const ids = skill.template_ids || [];
      setSkillTemplateIds(ids);  // 存储数字数组
    } else {
      skillForm.resetFields();
      setSkillTemplateIds([]);
    }
    setSkillModalVisible(true);
  };

  const handleSaveSkill = async (values) => {
    try {
      // 保存时，template_ids 需要是数字数组
      const payload = {
        name: values.name,
        description: values.description,
        template_ids: skillTemplateIds  // 已经是数字数组
      };
      if (editingSkill) {
        await axios.put(`/api/skills/${editingSkill.id}`, payload);
        message.success('技能更新成功');
      } else {
        await axios.post('/api/skills', payload);
        message.success('技能创建成功');
      }
      setSkillModalVisible(false);
      fetchSkills();
    } catch (err) {
      message.error(err.response?.data?.detail || '操作失败');
    }
  };

  const deleteSkill = async (skillId) => {
    try {
      await axios.delete(`/api/skills/${skillId}`);
      message.success('删除成功');
      fetchSkills();
    } catch (err) {
      message.error('删除失败');
    }
  };

const applySkill = async (skillId) => {
  setLoading(true);
  try {
    const res = await axios.post(`/api/skills/apply/${skillId}`);
    const { session_id, skill_ambiguities } = res.data;
    if (!session_id) throw new Error('未返回会话ID');
    
    // 清除旧会话缓存
    sessionStorage.removeItem('codegen_session_id');
    sessionStorage.removeItem('codegen_messages');
    sessionStorage.removeItem('codegen_awaiting_answer');
    sessionStorage.removeItem('codegen_experimental_code');
    sessionStorage.removeItem('codegen_baseline_code');
    sessionStorage.removeItem('codegen_is_generated');
    sessionStorage.removeItem('codegen_clarified_spec');
    
    // 存储新会话ID
    sessionStorage.setItem('codegen_session_id', session_id);
    // 可选：存储技能名称用于提示
    sessionStorage.setItem('applied_skill', JSON.stringify(skill_ambiguities));
    
    message.success(`技能已应用，请在需求澄清助手中输入您的具体需求`);
    navigate('/codegen');
  } catch (err) {
    const errorMsg = err.response?.data?.detail || err.message || '应用技能失败';
    message.error(errorMsg);
  } finally {
    setLoading(false);
  }
};

  // Transfer 事件处理：targetKeys 是字符串数组，需要转换为数字数组存储
  const handleTransferChange = (targetKeys) => {
    const numericKeys = targetKeys.map(key => parseInt(key, 10));
    setSkillTemplateIds(numericKeys);
  };

  // Transfer 需要字符串数组作为 targetKeys
  const transferTargetKeys = skillTemplateIds.map(id => String(id));

  // 模板表格列
  const templateColumns = [
    { title: '维度', dataIndex: 'dimension' },
    { title: '问题文本', dataIndex: 'question_text', ellipsis: true },
    { title: '默认答案', dataIndex: 'default_answer' },
    { title: '排序', dataIndex: 'sort_order' },
    { title: '状态', dataIndex: 'is_active', render: (v) => v ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag> },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => { setEditingTemplate(record); templateForm.setFieldsValue(record); setTemplateModalVisible(true); }}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => deleteTemplate(record.id)}>
            <Button icon={<DeleteOutlined />} danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ];

  // 技能表格列
  const skillColumns = [
    { title: '技能名称', dataIndex: 'name' },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '关联模板数', dataIndex: 'template_ids', render: (ids) => ids ? ids.length : 0 },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => openSkillModal(record)}>编辑</Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => applySkill(record.id)} loading={loading}>应用</Button>
          <Popconfirm title="确定删除该技能？" onConfirm={() => deleteSkill(record.id)}>
            <Button icon={<DeleteOutlined />} danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <Tabs defaultActiveKey="skills">
          <TabPane tab={<span><AppstoreOutlined /> 技能列表</span>} key="skills">
            <div style={{ marginBottom: 16 }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openSkillModal()}>新建技能</Button>
            </div>
            <Table dataSource={skills} columns={skillColumns} rowKey="id" pagination={{ pageSize: 10 }} />
          </TabPane>

          <TabPane tab={<span><UnorderedListOutlined /> 模板管理</span>} key="templates">
            <div style={{ marginBottom: 16 }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingTemplate(null); templateForm.resetFields(); setTemplateModalVisible(true); }}>新增模板</Button>
            </div>
            <Table dataSource={templates} columns={templateColumns} rowKey="id" pagination={{ pageSize: 10 }} />
          </TabPane>
        </Tabs>
      </Card>

      {/* 技能编辑模态框 */}
      <Modal
        title={editingSkill ? "编辑技能" : "新建技能"}
        open={skillModalVisible}
        onCancel={() => setSkillModalVisible(false)}
        width={700}
        footer={null}
      >
        <Form form={skillForm} onFinish={handleSaveSkill} layout="vertical">
          <Form.Item name="name" label="技能名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item label="关联模板">
            <Transfer
              dataSource={templateOptions}
              titles={['可用模板', '已选模板']}
              targetKeys={transferTargetKeys}
              onChange={handleTransferChange}
              render={item => item.title}
              listStyle={{ width: 250, height: 400 }}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存</Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setSkillModalVisible(false)}>取消</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 模板编辑模态框 */}
      <Modal
        title={editingTemplate ? "编辑模板" : "新增模板"}
        open={templateModalVisible}
        onCancel={() => setTemplateModalVisible(false)}
        footer={null}
        width={700}
      >
        <Form form={templateForm} layout="vertical" onFinish={handleSaveTemplate}>
          <Form.Item name="dimension" label="维度" rules={[{ required: true }]}>
            <Input placeholder="例如：Web开发、数据处理、算法题" />
          </Form.Item>
          <Form.Item name="question_text" label="问题文本" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="例如：需要支持哪些输入类型？&#10;A. 整数&#10;B. 浮点数&#10;C. 字符串&#10;D. 其他" />
          </Form.Item>
          <Form.Item name="default_answer" label="默认答案">
            <Input placeholder="例如：A" />
          </Form.Item>
          <Form.Item name="sort_order" label="排序" initialValue={0}>
            <InputNumber min={0} />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}