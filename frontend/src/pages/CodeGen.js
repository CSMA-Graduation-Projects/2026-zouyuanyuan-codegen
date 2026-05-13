import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../AuthContext';
import {
  Button, Select, message, Card, Row, Col, Typography, Space, Alert,
  Input, Modal, Table, Form, Popconfirm, InputNumber, Radio, Tabs,
  Collapse, Tag, Spin, Tooltip
} from 'antd';
import {
  CopyOutlined, DownloadOutlined, RollbackOutlined, ReloadOutlined,
  StarOutlined, EditOutlined, DeleteOutlined, PlusOutlined,
  ExperimentOutlined, BugOutlined, HighlightOutlined,
  BarChartOutlined
} from '@ant-design/icons';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Link } from 'react-router-dom';

const { TextArea } = Input;
const { TabPane } = Tabs;
const { Panel } = Collapse;
const { Title, Paragraph, Text } = Typography;

export default function CodeGen() {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem('codegen_session_id') || null);
  const [messages, setMessages] = useState(() => {
    const saved = sessionStorage.getItem('codegen_messages');
    return saved ? JSON.parse(saved) : [];
  });
  const [inputValue, setInputValue] = useState('');
  const [code, setCode] = useState(() => sessionStorage.getItem('codegen_experimental_code') || '');
  const [baselineCode, setBaselineCode] = useState(() => sessionStorage.getItem('codegen_baseline_code') || '');
  const [explanation, setExplanation] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isCodeGenerated, setIsCodeGenerated] = useState(() => sessionStorage.getItem('codegen_is_generated') === 'true');
  const [awaitingAnswer, setAwaitingAnswer] = useState(() => {
    const saved = sessionStorage.getItem('codegen_awaiting_answer');
    return saved ? JSON.parse(saved) : false;
  });
  const [generationMode] = useState('standard');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [ambiguities, setAmbiguities] = useState([]);
  const [showAmbiguityModal, setShowAmbiguityModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => sessionStorage.getItem('codegen_model') || '');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelChangedByUser, setModelChangedByUser] = useState(false);
  const [form] = Form.useForm();
  const messagesEndRef = useRef(null);
  const initialized = useRef(false);

  const [scoreModalVisible, setScoreModalVisible] = useState(false);
  const [pendingCode, setPendingCode] = useState(null);
  const [autoScore, setAutoScore] = useState(null);
  const [userScore, setUserScore] = useState(85);

  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [activeTab, setActiveTab] = useState('experimental');
  const [clarifiedSpec, setClarifiedSpec] = useState(() => {
    const saved = sessionStorage.getItem('codegen_clarified_spec');
    return saved ? JSON.parse(saved) : {};
  });

  const [appliedSkill, setAppliedSkill] = useState(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    if (code) sessionStorage.setItem('codegen_experimental_code', code);
    if (baselineCode) sessionStorage.setItem('codegen_baseline_code', baselineCode);
    sessionStorage.setItem('codegen_is_generated', isCodeGenerated);
  }, [code, baselineCode, isCodeGenerated]);

  useEffect(() => {
    if (clarifiedSpec && Object.keys(clarifiedSpec).length > 0) {
      sessionStorage.setItem('codegen_clarified_spec', JSON.stringify(clarifiedSpec));
    }
  }, [clarifiedSpec]);

  useEffect(() => {
    if (messages.length > 0) sessionStorage.setItem('codegen_messages', JSON.stringify(messages));
  }, [messages]);
  useEffect(() => {
    sessionStorage.setItem('codegen_awaiting_answer', JSON.stringify(awaitingAnswer));
  }, [awaitingAnswer]);
  useEffect(() => {
    sessionStorage.setItem('codegen_model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (modelChangedByUser && !modelsLoading && availableModels.length > 0) {
      resetSession();
      setModelChangedByUser(false);
    }
  }, [selectedModel, modelChangedByUser, modelsLoading, availableModels]);

  useEffect(() => {
    const skillData = sessionStorage.getItem('applied_skill');
    if (skillData) {
      try {
        const parsed = JSON.parse(skillData);
        setAppliedSkill(parsed);
        setTimeout(() => sessionStorage.removeItem('applied_skill'), 5000);
      } catch (e) {}
    }
  }, []);

const parseOptions = (questionText) => {
  const lines = questionText.split('\n');
  const options = [];
  for (const line of lines) {
    // 匹配模式：A. 内容 或 A、内容 或 A) 内容 或 A 内容（后面至少一个空格）
    const match = line.match(/^\s*([A-Za-z0-9])[\.\、\)]?\s+(.+)$/);
    if (match) {
      options.push({ key: match[1], text: match[2].trim() });
    }
  }
  return options;
};

  useEffect(() => {
    const fetchModels = async () => {
      setModelsLoading(true);
      try {
        const res = await axios.get('/api/model_configs');
        const activeModels = res.data.filter(m => m.is_active === true);
        const modelNames = activeModels.map(m => m.name);
        setAvailableModels(modelNames);
        if (modelNames.length === 0) {
          message.warning('没有可用的模型配置，请联系管理员添加并启用');
        } else {
          const storedModel = sessionStorage.getItem('codegen_model');
          if (storedModel && modelNames.includes(storedModel)) {
            setSelectedModel(storedModel);
          } else {
            setSelectedModel(modelNames[0]);
          }
        }
      } catch (err) {
        console.error('获取模型列表失败', err);
        message.error('获取模型列表失败，请检查后端服务');
        setAvailableModels([]);
      } finally {
        setModelsLoading(false);
      }
    };
    fetchModels();
  }, []);

  const syncSessionState = useCallback(async (sid) => {
    if (!sid) return false;
    try {
      const res = await axios.get(`/api/session/${sid}/status`);
      const data = res.data;
      if (data.awaiting_answer) {
        setAwaitingAnswer(true);
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role !== 'assistant' || lastMsg.content !== data.current_question) {
          setMessages(prev => {
            if (prev.length && prev[prev.length-1].role === 'assistant' && prev[prev.length-1].content === data.current_question) return prev;
            return [...prev, { role: 'assistant', content: data.current_question }];
          });
        }
      } else {
        setAwaitingAnswer(false);
      }
      if (data.conversation_history && data.conversation_history.length > messages.length) {
        setMessages(data.conversation_history);
      }
      return true;
    } catch (err) {
      if (err.response && (err.response.status === 404 || err.response.status === 403)) {
        sessionStorage.removeItem('codegen_session_id');
        sessionStorage.removeItem('codegen_messages');
        sessionStorage.removeItem('codegen_awaiting_answer');
        setSessionId(null);
        setMessages([]);
        setAwaitingAnswer(false);
        await initSession();
      }
      return false;
    }
  }, [messages]);

  const initSession = useCallback(async () => {
    if (!selectedModel || availableModels.length === 0) return;
    try {
      const res = await axios.post(`/api/start?model=${selectedModel}`);
      const newSessionId = res.data.session_id;
      setSessionId(newSessionId);
      sessionStorage.setItem('codegen_session_id', newSessionId);
      const welcomeMsg = [{ role: 'assistant', content: '你好！我是智能代码生成助手。请描述你需要的功能，系统会识别模糊点并请确认。' }];
      setMessages(welcomeMsg);
      sessionStorage.setItem('codegen_messages', JSON.stringify(welcomeMsg));
      setCode('');
      setBaselineCode('');
      setExplanation('');
      setSuggestions([]);
      setIsCodeGenerated(false);
      setAwaitingAnswer(false);
      setTestResult(null);
      setClarifiedSpec({});
      sessionStorage.removeItem('codegen_awaiting_answer');
      sessionStorage.removeItem('codegen_experimental_code');
      sessionStorage.removeItem('codegen_baseline_code');
      sessionStorage.removeItem('codegen_is_generated');
      sessionStorage.removeItem('codegen_clarified_spec');
    } catch (err) {
      message.error('连接服务器失败：' + (err.response?.data?.detail || err.message));
    }
  }, [selectedModel, availableModels]);

  const resetSession = async () => {
    sessionStorage.removeItem('codegen_session_id');
    sessionStorage.removeItem('codegen_messages');
    sessionStorage.removeItem('codegen_awaiting_answer');
    setSessionId(null);
    setMessages([]);
    setCode('');
    setBaselineCode('');
    setExplanation('');
    setSuggestions([]);
    setIsCodeGenerated(false);
    setAwaitingAnswer(false);
    setTestResult(null);
    setClarifiedSpec({});
    await initSession();
  };

  const initialize = useCallback(async () => {
    if (initialized.current) return;
    if (modelsLoading) return;
    if (availableModels.length === 0) return;
    initialized.current = true;
    const storedSid = sessionStorage.getItem('codegen_session_id');
    if (storedSid) {
      setSessionId(storedSid);
      await syncSessionState(storedSid);
    } else {
      await initSession();
    }
  }, [modelsLoading, availableModels, syncSessionState, initSession]);

  useEffect(() => {
    if (!modelsLoading && availableModels.length > 0 && !initialized.current) {
      initialize();
    }
  }, [modelsLoading, availableModels, initialize]);

  if (modelsLoading) return <div style={{ padding: 24, textAlign: 'center' }}>正在加载模型配置...</div>;
  if (availableModels.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Alert type="error" message="没有可用的模型" description="请管理员在「模型配置」页面添加并启用至少一个模型，然后刷新本页面。" showIcon />
      </div>
    );
  }

  const sendRequirement = async () => {
    if (!inputValue.trim() || loading) return;
    const userMsg = { role: 'user', content: inputValue };
    setMessages(prev => [...prev, userMsg]);
    const reqText = inputValue;
    setInputValue('');
    setLoading(true);
    try {
      const res = await axios.post('/api/detect', { requirement: reqText, session_id: sessionId, mode: generationMode });
      if (res.data && Array.isArray(res.data)) {
        setAmbiguities(res.data);
        setShowAmbiguityModal(true);
      } else {
        message.error('识别模糊点失败');
      }
    } catch (err) {
      message.error('处理失败：' + (err.response?.data?.detail || err.message));
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ 处理失败，请重试。' }]);
    }
    setLoading(false);
  };

  const confirmAmbiguities = async () => {
    setShowAmbiguityModal(false);
    setLoading(true);
    try {
      const payload = {
        session_id: sessionId,
        ambiguities: ambiguities
      };
      const res = await axios.post('/api/confirm_ambiguities', payload);
      if (res.data.ready) {
        setCode(res.data.code);
        setBaselineCode(res.data.baseline_code || '');
        setExplanation(res.data.explanation);
        setSuggestions(res.data.security_suggestions || []);
        setIsCodeGenerated(true);
        setMessages(prev => [...prev, { role: 'assistant', content: '✅ 代码已生成！' }]);
        if (res.data.security_suggestions?.length) setShowSuggestions(true);
        let originalRequirement = '';
        try {
          const summaryRes = await axios.get(`/api/session/${sessionId}/summary`);
          if (summaryRes.data?.clarified_spec) setClarifiedSpec(summaryRes.data.clarified_spec);
          originalRequirement = summaryRes.data.original_requirement || '';
        } catch {}
        let specTitle = '未命名需求';
        if (originalRequirement) {
          specTitle = originalRequirement.length > 30 ? originalRequirement.substring(0, 30) + '...' : originalRequirement;
        }
        try {
          await axios.post('/api/spec_documents', {
            session_id: sessionId,
            title: specTitle,
            conversation_history: messages
          });
        } catch {}
        showScoreModal(res.data.code);
      } else {
        setAwaitingAnswer(true);
        setMessages(prev => [...prev, { role: 'assistant', content: res.data.first_question }]);
      }
    } catch (err) {
      message.error('确认模糊点失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const addAmbiguity = () => {
    form.resetFields();
    Modal.confirm({
      title: '添加模糊点',
      content: (
        <Form form={form} layout="vertical">
          <Form.Item name="dimension" label="维度" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述" rules={[{ required: true }]}><Input.TextArea /></Form.Item>
        </Form>
      ),
      onOk: () => form.validateFields().then(values => setAmbiguities([...ambiguities, values]))
    });
  };

  const editAmbiguity = (index) => {
    const item = ambiguities[index];
    form.setFieldsValue({ dimension: item.dimension, description: item.description });
    Modal.confirm({
      title: '编辑模糊点',
      content: (
        <Form form={form} layout="vertical">
          <Form.Item name="dimension" label="维度" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述" rules={[{ required: true }]}><Input.TextArea /></Form.Item>
        </Form>
      ),
      onOk: () => form.validateFields().then(values => {
        const newList = [...ambiguities];
        newList[index] = values;
        setAmbiguities(newList);
      })
    });
  };

  const deleteAmbiguity = (index) => {
    setAmbiguities(prev => prev.filter((_, i) => i !== index));
  };

  const showScoreModal = (generatedCode) => {
    setPendingCode(generatedCode);
    setScoreModalVisible(true);
    axios.post('/api/rate_code', { session_id: sessionId, code: generatedCode })
      .then(res => {
        setAutoScore(res.data.auto_score);
        setUserScore(res.data.auto_score);
      })
      .catch(() => {
        message.error('获取自动评分失败，请手动输入');
        setAutoScore(null);
      });
  };

  const handleScoreSubmit = async () => {
    if (userScore == null) return message.error('请输入评分');
    if (userScore < 0 || userScore > 100) return message.error('评分应在 0-100 之间');
    setScoreModalVisible(false);
    try {
      const ratingRes = await axios.post('/api/rate_code', {
        session_id: sessionId, code: pendingCode, user_score: userScore, auto_score: autoScore
      });
      const { score, suggestion } = ratingRes.data;
      message.info(`您的评分：${score}分，${suggestion}`);
      if (score >= 85) {
        Modal.confirm({
          title: '高质量代码',
          content: `您评分为 ${score}，是否收录到高质量案例库？`,
          onOk: async () => {
            await axios.post('/api/cases/mark', { session_id: sessionId });
            message.success('已收录');
          }
        });
      }
      setPendingCode(null);
    } catch (err) {
      message.error('提交评分失败：' + (err.response?.data?.detail || err.message));
    }
  };

  const sendAnswer = async () => {
    if (!inputValue.trim() || loading) return;
    if (!awaitingAnswer) return sendRequirement();
    const userMsg = { role: 'user', content: inputValue };
    setMessages(prev => [...prev, userMsg]);
    const ans = inputValue.trim();
    setInputValue('');
    setLoading(true);
    setAwaitingAnswer(false);
    try {
      const res = await axios.post('/api/answer', { answer: ans, session_id: sessionId });
      if (res.data.ready) {
        setCode(res.data.code);
        setBaselineCode(res.data.baseline_code || '');
        setExplanation(res.data.explanation);
        setSuggestions(res.data.security_suggestions || []);
        setIsCodeGenerated(true);
        setMessages(prev => [...prev, { role: 'assistant', content: '✅ 代码已生成！' }]);
        if (res.data.security_suggestions?.length) setShowSuggestions(true);
        let originalRequirement = '';
        try {
          const summaryRes = await axios.get(`/api/session/${sessionId}/summary`);
          if (summaryRes.data?.clarified_spec) setClarifiedSpec(summaryRes.data.clarified_spec);
          originalRequirement = summaryRes.data.original_requirement || '';
        } catch {}
        let specTitle = '未命名需求';
        if (originalRequirement) {
          specTitle = originalRequirement.length > 30 ? originalRequirement.substring(0, 30) + '...' : originalRequirement;
        }
        try {
          await axios.post('/api/spec_documents', {
            session_id: sessionId,
            title: specTitle,
            conversation_history: messages
          });
        } catch {}
        showScoreModal(res.data.code);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: res.data.question }]);
        setAwaitingAnswer(true);
      }
    } catch (err) {
      message.error('处理失败：' + (err.response?.data?.detail || err.message));
      setAwaitingAnswer(true);
    } finally { setLoading(false); }
  };

  const handleRollback = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await axios.post('/api/rollback', { session_id: sessionId });
      if (res.data.success) {
        if (res.data.ready) {
          setCode(res.data.code);
          setBaselineCode(res.data.baseline_code || '');
          setExplanation(res.data.explanation);
          setSuggestions(res.data.security_suggestions || []);
          setIsCodeGenerated(true);
          setAwaitingAnswer(false);
          setMessages(prev => [...prev, { role: 'assistant', content: '✅ 回滚后代码已生成。' }]);
          let originalRequirement = '';
          try {
            const summaryRes = await axios.get(`/api/session/${sessionId}/summary`);
            if (summaryRes.data?.clarified_spec) setClarifiedSpec(summaryRes.data.clarified_spec);
            originalRequirement = summaryRes.data.original_requirement || '';
          } catch {}
          let specTitle = '未命名需求';
          if (originalRequirement) {
            specTitle = originalRequirement.length > 30 ? originalRequirement.substring(0, 30) + '...' : originalRequirement;
          }
          try {
            await axios.post('/api/spec_documents', {
              session_id: sessionId,
              title: specTitle,
              conversation_history: messages
            });
          } catch {}
          showScoreModal(res.data.code);
        } else {
          setAwaitingAnswer(true);
          setMessages(prev => [...prev, { role: 'assistant', content: `↩️ 请回答：${res.data.question}` }]);
        }
      } else message.warning('无历史状态');
    } catch (err) {
      message.error('回滚失败');
    } finally { setLoading(false); }
  };

  const saveCode = (codeToSave) => {
    if (!codeToSave) return;
    const blob = new Blob([codeToSave], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'generated_code.py';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyCode = (codeToCopy) => {
    if (codeToCopy) {
      navigator.clipboard.writeText(codeToCopy);
      message.success('已复制');
    }
  };

  const markAsHighQuality = async () => {
    try {
      await axios.post('/api/cases/mark', { session_id: sessionId });
      message.success('已标记为高质量案例');
    } catch (err) {
      message.error('标记失败：' + (err.response?.data?.detail || err.message));
    }
  };

  const handleSend = () => awaitingAnswer ? sendAnswer() : sendRequirement();

  const runBothTests = async () => {
    if (!code || !baselineCode) {
      message.error('需要先生成实验组和对照组代码');
      return;
    }
    try {
      const checkRes = await axios.post('/api/check_testable', {
        experimental_code: code,
        baseline_code: baselineCode
      });
      if (!checkRes.data.experimental_testable) {
        message.error(`实验组代码不可测试：${checkRes.data.experimental_reason}`);
        return;
      }
      if (!checkRes.data.baseline_testable) {
        message.error(`对照组代码不可测试：${checkRes.data.baseline_reason}`);
        return;
      }
    } catch (err) {
      message.error('检测代码可测试性失败，请稍后重试');
      return;
    }
    setTesting(true);
    try {
      let originalRequirement = '';
      try {
        const summaryRes = await axios.get(`/api/session/${sessionId}/summary`);
        originalRequirement = summaryRes.data.original_requirement;
      } catch {}
      if (!originalRequirement) {
        message.error('无法获取原始需求');
        setTesting(false);
        return;
      }
      const genRes = await axios.post('/api/generate_test_code', { requirement: originalRequirement, code });
      const testCode = genRes.data.test_code;
      const [expResult, baseResult] = await Promise.all([
        axios.post('/api/test_code', { code, test_code: testCode }),
        axios.post('/api/test_code', { code: baselineCode, test_code: testCode })
      ]);
      const expPassRate = expResult.data.pass_rate;
      const basePassRate = baseResult.data.pass_rate;
      const expPassed = expPassRate === 100;
      const basePassed = basePassRate === 100;
      await axios.post('/api/test_results/save', {
        session_id: sessionId,
        experimental_pass_rate: expPassRate,
        baseline_pass_rate: basePassRate,
        experimental_passed: expPassed,
        baseline_passed: basePassed,
        test_code: testCode
      });
      setTestResult({
        experimental: { ...expResult.data, pass: expPassed },
        baseline: { ...baseResult.data, pass: basePassed }
      });
      message.success('测试完成，结果已保存至数据库');
    } catch (err) {
      message.error('测试失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setTesting(false);
    }
  };

  const renderTestResults = () => {
    if (!testResult?.experimental || !testResult?.baseline) return null;
    const exp = testResult.experimental;
    const base = testResult.baseline;
    if (typeof exp.pass !== 'boolean' || typeof base.pass !== 'boolean') return null;
    return (
      <div style={{ marginTop: 16 }}>
        <Alert
          message="测试完成"
          description={
            <>
              <p>实验组（澄清后）：<Tag color={exp.pass ? 'green' : 'red'}>{exp.pass ? '通过' : '未通过'}</Tag></p>
              <p>对照组（直接生成）：<Tag color={base.pass ? 'green' : 'red'}>{base.pass ? '通过' : '未通过'}</Tag></p>
              <p style={{ marginTop: 8 }}>
                详细测试数据请前往 <Link to="/analysis"><Button type="link" icon={<BarChartOutlined />}>代码分析</Button></Link> 查看。
              </p>
            </>
          }
          type="info"
          showIcon
        />
      </div>
    );
  };

  const ambiguityColumns = [
    { title: '维度', dataIndex: 'dimension', width: 200 },
    { title: '描述', dataIndex: 'description' },
    {
      title: '操作', width: 150, render: (_, __, index) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => editAmbiguity(index)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => deleteAmbiguity(index)}>
            <Button icon={<DeleteOutlined />} size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const renderClarifiedSpec = () => {
    if (!clarifiedSpec || Object.keys(clarifiedSpec).length === 0) return <Text type="secondary">暂无澄清信息</Text>;
    return (
      <Collapse ghost>
        {Object.entries(clarifiedSpec).map(([key, value]) => (
          <Panel header={<span><HighlightOutlined style={{ color: '#52c41a' }} /> {key}</span>} key={key}>
            <Tag color="green">补充信息</Tag> {value}
          </Panel>
        ))}
      </Collapse>
    );
  };

  // 高亮显示包含 # CLARIFIED: 的行
  const renderHighlightedCode = (codeText) => {
    return (
      <SyntaxHighlighter
        language="python"
        style={vscDarkPlus}
        showLineNumbers
        lineProps={(lineNumber) => {
          const lines = codeText.split('\n');
          const lineText = lines[lineNumber - 1];
          if (lineText && lineText.includes('# CLARIFIED:')) {
            return { style: { backgroundColor: '#f0e68c', display: 'block', width: '100%' } };
          }
          return {};
        }}
        wrapLines={true}
      >
        {codeText}
      </SyntaxHighlighter>
    );
  };

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
      {appliedSkill && (
        <Alert
          message="技能已应用"
          description={`系统已自动添加以下澄清项，您无需重复回答：${appliedSkill.map(s => s.dimension).join('、')}`}
          type="info"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          onClose={() => setAppliedSkill(null)}
        />
      )}
      <Row gutter={24}>
        <Col span={12}>
          <Card title="💬 需求澄清对话" extra={
            <Space>
              <Select
                value={selectedModel}
                onChange={(newModel) => {
                  if (newModel === selectedModel) return;
                  setSelectedModel(newModel);
                  sessionStorage.setItem('codegen_model', newModel);
                  setModelChangedByUser(true);
                }}
                style={{ width: 120 }}
                disabled={availableModels.length === 0}
              >
                {availableModels.map(m => <Select.Option key={m} value={m}>{m}</Select.Option>)}
              </Select>
              <Button icon={<RollbackOutlined />} onClick={handleRollback} loading={loading}>回滚</Button>
              <Button icon={<ReloadOutlined />} onClick={resetSession}>新对话</Button>
            </Space>
          }>
            <div style={{ height: 500, overflowY: 'auto', marginBottom: 16, background: '#fafafa', padding: 12, borderRadius: 8 }}>
              {messages.map((msg, idx) => (
                <div key={idx} style={{ textAlign: msg.role === 'user' ? 'right' : 'left', marginBottom: 12 }}>
                  <div style={{ display: 'inline-block', background: msg.role === 'user' ? '#dcf8c6' : '#f1f0f0', padding: '8px 14px', borderRadius: 18, maxWidth: '80%', whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </div>
                  {msg.role === 'assistant' && parseOptions(msg.content).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Radio.Group
                        onChange={(e) => {
                          setInputValue(e.target.value);
                          // 移除顶部提示
                        }}
                      >
                        <Space direction="vertical">
                          {parseOptions(msg.content).map(opt => (
                            <Radio key={opt.key} value={opt.key}>{opt.key}. {opt.text}</Radio>
                          ))}
                        </Space>
                      </Radio.Group>
                    </div>
                  )}
                </div>
              ))}
              {loading && <div style={{ textAlign: 'left' }}>🤔 思考中...</div>}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <TextArea rows={3} value={inputValue} onChange={e => setInputValue(e.target.value)} placeholder={awaitingAnswer ? "请输入你的回答..." : "输入需求..."} disabled={loading} />
              <Button type="primary" onClick={handleSend} loading={loading} style={{ height: 'auto' }}>发送</Button>
            </div>
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={<Space><ExperimentOutlined /> 代码对比与测试 {isCodeGenerated && <Tag color="green">已生成</Tag>}</Space>}
            extra={isCodeGenerated && (
              <Space>
                <Tooltip title="仅支持纯函数代码（语法正确且无 GUI/Web 框架）">
                  <Button icon={<BugOutlined />} onClick={runBothTests} loading={testing}>一键测试</Button>
                </Tooltip>
                <Button icon={<StarOutlined />} onClick={markAsHighQuality}>收录案例</Button>
              </Space>
            )}
          >
            {isCodeGenerated ? (
              <>
                <Tabs activeKey={activeTab} onChange={setActiveTab}>
                  <TabPane tab="实验组 (澄清后)" key="experimental">
                    <div style={{ marginBottom: 8 }}>
                      <Space>
                        <Button icon={<CopyOutlined />} onClick={() => copyCode(code)}>复制</Button>
                        <Button icon={<DownloadOutlined />} onClick={() => saveCode(code)}>保存</Button>
                      </Space>
                    </div>
                    {renderHighlightedCode(code)}
                  </TabPane>
                  <TabPane tab="对照组 (直接生成)" key="baseline">
                    <div style={{ marginBottom: 8 }}>
                      <Space>
                        <Button icon={<CopyOutlined />} onClick={() => copyCode(baselineCode)}>复制</Button>
                        <Button icon={<DownloadOutlined />} onClick={() => saveCode(baselineCode)}>保存</Button>
                      </Space>
                    </div>
                    {baselineCode ? (
                      <SyntaxHighlighter language="python" style={vscDarkPlus} showLineNumbers>
                        {baselineCode}
                      </SyntaxHighlighter>
                    ) : (
                      <div style={{ textAlign: 'center', padding: 50, color: '#999' }}>尚未生成对照组代码</div>
                    )}
                  </TabPane>
                </Tabs>
                {explanation && explanation !== "代码已生成" && (
                  <div style={{ marginTop: 16, background: '#f6ffed', padding: 12, borderRadius: 8 }}>
                    <Title level={5}>📖 代码解释</Title>
                    <Paragraph>{explanation}</Paragraph>
                  </div>
                )}
                {suggestions.length > 0 && showSuggestions && (
                  <Alert message="🔒 安全与性能建议" description={<ul>{suggestions.map((s,i)=><li key={i}>{s}</li>)}</ul>} type="warning" showIcon closable onClose={() => setShowSuggestions(false)} style={{ marginTop: 16 }} />
                )}
                <div style={{ marginTop: 16 }}>
                  <Title level={5}>📝 澄清需求细节（高亮补充信息）</Title>
                  {renderClarifiedSpec()}
                </div>
                {renderTestResults()}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 100, color: '#888' }}>
                <p>✨ 代码将在这里显示</p>
                <p>请在左侧描述需求，系统会引导您完善细节后生成代码。</p>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Modal title="编辑模糊点" open={showAmbiguityModal} onCancel={() => setShowAmbiguityModal(false)} width={800}
        footer={[
          <Button key="cancel" onClick={() => setShowAmbiguityModal(false)}>取消</Button>,
          <Button key="add" type="dashed" icon={<PlusOutlined />} onClick={addAmbiguity}>新增</Button>,
          <Button key="ok" type="primary" onClick={confirmAmbiguities}>确认并开始澄清</Button>
        ]}>
        <Table dataSource={ambiguities} columns={ambiguityColumns} rowKey={(_, idx) => idx} pagination={false} size="small" />
      </Modal>

      <Modal title="代码质量评分" open={scoreModalVisible} onCancel={() => setScoreModalVisible(false)} onOk={handleScoreSubmit} okText="提交评分" cancelText="取消" width={800}>
        <div style={{ marginBottom: 16 }}>
          <p><strong>生成的代码：</strong></p>
          <pre style={{ background: '#f5f5f5', color: 'black', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 13, maxHeight: 300 }}>
            {pendingCode || '暂无代码'}
          </pre>
        </div>
        <div style={{ marginBottom: 16 }}>
          <p>系统自动评分：{autoScore !== null ? `${autoScore} 分` : '未获取'}</p>
          <p>请给出您的评分（0-100）：</p>
          <InputNumber min={0} max={100} value={userScore} onChange={setUserScore} style={{ width: '100%' }} placeholder="请输入 0-100 的整数" />
        </div>
      </Modal>
    </div>
  );
}