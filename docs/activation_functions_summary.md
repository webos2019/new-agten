# 激活函数总结 — Activation Functions

> 来源: [Datawhale 大模型算法实战教程 — 14. Activation Functions](https://datawhalechina.github.io/llm-algo-leetcode/00_Prerequisites/14_Activation_Functions.html)
> 难度: Easy | 标签: `PyTorch`, `非线性`, `激活`

---

## 一句话概括

激活函数的作用是把**线性堆叠变成可学习表达**——给模型加"非线性开关"，让一层层线性变换能组合出复杂模式。

---

## 三大激活函数

| 函数 | 公式 | 特点 | 常见场景 |
|------|------|------|----------|
| **ReLU** | `max(0, x)` | 简单、稀疏、负值直接截断为 0 | 通用基线 |
| **GELU** | `0.5x(1 + erf(x/√2))` | 平滑过渡，负值不完全丢弃 | Transformer (BERT/GPT) |
| **SiLU** | `x · sigmoid(x)` | 平滑且有门控特性 | 门控结构 (LLaMA SwiGLU) |

### 直觉对比

- **ReLU**: 负值 → 0，正值 → 原值。简单但会丢失负值信息
- **GELU**: 负值小幅保留，过渡平滑。比 ReLU 更"温和"
- **SiLU**: 负值乘以一个小的 sigmoid 值，天然适合门控

```python
import torch, torch.nn.functional as F

# 三种等价写法
x = torch.tensor([-2.0, -1.0, 0.0, 1.0, 2.0])

F.relu(x)       # tensor([0., 0., 0., 1., 2.])
F.gelu(x)       # tensor([-0.046, -0.159, 0.000, 0.841, 1.954])
F.silu(x)       # tensor([-0.238, -0.269, 0.000, 0.731, 1.762])
```

---

## 核心认知：激活函数是"分布整形器"

不只看公式，还要看它**对输入分布的改变程度**：

- ReLU 会把所有负值截断为 0 → 分布偏向正侧，可能丢失信息
- GELU 平滑过渡 → 分布更均匀
- SiLU 门控特性 → 负值不完全丢，但被压制

```python
x = torch.tensor([-3.0, -1.0, 0.0, 2.0])
summary = {
    'relu_mean': float(F.relu(x).mean()),    # 0.5
    'gelu_mean': float(F.gelu(x).mean()),    # ~0.16
    'silu_mean': float(F.silu(x).mean()),    # ~0.06
}
# ReLU 均值最高（负值全截断），SiLU 最低（负值被门控压制）
```

---

## 什么时候换激活 vs 换归一化？

| 问题现象 | 优先处理 |
|---------|---------|
| 特征被截断（负值信息丢失） | **换激活函数** |
| 门控不顺畅 | **换激活函数** |
| 整体统计不稳 | **换归一化** |
| 梯度流异常 | **两者都看** |

简单记法：**激活管"有没有非线性"，归一化管"数值稳不稳"**。

---

## 激活与训练稳定性

激活函数不只影响非线性，还影响训练链路的稳定性：

| 信号 | 触发条件 | 下一步 |
|------|---------|--------|
| `stability_risk` | `max_abs > 10` 或有重尾分布 | 检查激活 + 归一化 |
| `gradient_risk` | 梯度爆炸 | 检查激活缩放 |
| `ok` | 正常 | 继续训练 |

---

## 在 LLM 中的位置

如果把 LLaMA 风格 block 看成重复结构：

```
Norm → Attention → Norm → MLP
                         ↑
                   激活函数在这里
```

- GELU / SiLU 最常出现在 **MLP 或门控 MLP** 中
- LLaMA 的 SwiGLU 就是 `SiLU + 门控` 的组合
- 激活函数的选择直接影响模型的表达能力和训练稳定性

---

## 速记清单

1. ReLU = 简单稀疏，负值全丢
2. GELU = 平滑过渡，Transformer 标配
3. SiLU = 门控友好，LLaMA 系列常用
4. 看激活不只看公式，要看分布变化
5. 截断/门控问题 → 换激活；统计不稳 → 换归一化
6. 激活函数 = 非线性 + 分布整形 + 稳定性控制
