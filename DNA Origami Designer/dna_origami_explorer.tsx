import React, { useState, useEffect } from 'react';
import { Sparkles, Cpu, Dna, RefreshCw } from 'lucide-react';

const DNAOrigamiExplorer = () => {
  const [activeTab, setActiveTab] = useState('origami');
  
  // Origami State
  const [scaffoldLength, setScaffoldLength] = useState(8);
  const [staplePattern, setStaplePattern] = useState('box');
  const [origamiGrid, setOrigamiGrid] = useState([]);
  
  // Quaternary Logic State
  const [qSeq1, setQSeq1] = useState('ATCG');
  const [qSeq2, setQSeq2] = useState('GCTA');
  const [qOperation, setQOperation] = useState('add');
  
  // Evolution State
  const [population, setPopulation] = useState([]);
  const [generation, setGeneration] = useState(0);
  const [mutationRate, setMutationRate] = useState(0.1);
  const [targetSequence, setTargetSequence] = useState('GATTACA');
  const [isEvolving, setIsEvolving] = useState(false);

  const complement = {'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C'};
  
  // ===== DNA ORIGAMI =====
  
  const generateOrigami = () => {
    const grid = [];
    const length = scaffoldLength;
    
    // Generate scaffold (long strand)
    const bases = ['A', 'T', 'C', 'G'];
    const scaffold = Array(length).fill(0).map(() => 
      bases[Math.floor(Math.random() * 4)]
    );
    
    // Generate staple patterns based on selected shape
    if (staplePattern === 'box') {
      // 2D rectangular grid
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let i = 0; i < length; i++) {
          const base = r === 0 ? scaffold[i] : complement[scaffold[i % scaffold.length]];
          row.push({
            base: base,
            type: r === 0 ? 'scaffold' : 'staple',
            bound: r > 0,
            position: [r, i]
          });
        }
        grid.push(row);
      }
    } else if (staplePattern === 'triangle') {
      // Triangular fold
      for (let r = 0; r < 5; r++) {
        const row = [];
        const rowLength = Math.min(length, length - r);
        for (let i = 0; i < rowLength; i++) {
          const base = r === 0 ? scaffold[i] : complement[scaffold[i % scaffold.length]];
          row.push({
            base: base,
            type: r === 0 ? 'scaffold' : 'staple',
            bound: r > 0,
            position: [r, i]
          });
        }
        grid.push(row);
      }
    } else if (staplePattern === 'smiley') {
      // Smiley face pattern (simplified)
      const rows = 6;
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let i = 0; i < length; i++) {
          const isEye = (r === 2 && (i === 2 || i === length - 3));
          const isMouth = (r === 4 && i > 1 && i < length - 2);
          const base = scaffold[i % scaffold.length];
          row.push({
            base: isEye || isMouth ? complement[base] : base,
            type: isEye || isMouth ? 'staple' : 'scaffold',
            bound: isEye || isMouth,
            position: [r, i]
          });
        }
        grid.push(row);
      }
    }
    
    setOrigamiGrid(grid);
  };
  
  useEffect(() => {
    generateOrigami();
  }, [scaffoldLength, staplePattern]);
  
  // ===== QUATERNARY LOGIC =====
  
  const baseToQuaternary = {
    'A': 0, 'T': 1, 'C': 2, 'G': 3
  };
  
  const quaternaryToBase = ['A', 'T', 'C', 'G'];
  
  const quaternaryAdd = (seq1, seq2) => {
    const maxLen = Math.max(seq1.length, seq2.length);
    const result = [];
    
    for (let i = 0; i < maxLen; i++) {
      const b1 = baseToQuaternary[seq1[i] || 'A'];
      const b2 = baseToQuaternary[seq2[i] || 'A'];
      result.push(quaternaryToBase[(b1 + b2) % 4]);
    }
    return result.join('');
  };
  
  const quaternaryMultiply = (seq1, seq2) => {
    const maxLen = Math.max(seq1.length, seq2.length);
    const result = [];
    
    for (let i = 0; i < maxLen; i++) {
      const b1 = baseToQuaternary[seq1[i] || 'A'];
      const b2 = baseToQuaternary[seq2[i] || 'A'];
      result.push(quaternaryToBase[(b1 * b2) % 4]);
    }
    return result.join('');
  };
  
  const quaternaryComplement = (seq) => {
    return seq.split('').map(b => complement[b]).join('');
  };
  
  const quaternaryRotate = (seq) => {
    // Rotate through bases: A→T→C→G→A
    const rotation = {'A': 'T', 'T': 'C', 'C': 'G', 'G': 'A'};
    return seq.split('').map(b => rotation[b]).join('');
  };
  
  const computeQuaternary = () => {
    switch(qOperation) {
      case 'add': return quaternaryAdd(qSeq1, qSeq2);
      case 'multiply': return quaternaryMultiply(qSeq1, qSeq2);
      case 'complement': return quaternaryComplement(qSeq1);
      case 'rotate': return quaternaryRotate(qSeq1);
      default: return '';
    }
  };
  
  const seqToDecimal = (seq) => {
    let value = 0;
    for (let i = 0; i < seq.length; i++) {
      value += baseToQuaternary[seq[i]] * Math.pow(4, seq.length - 1 - i);
    }
    return value;
  };
  
  // ===== EVOLUTION SIMULATION =====
  
  const initializePopulation = () => {
    const bases = ['A', 'T', 'C', 'G'];
    const popSize = 20;
    const pop = [];
    
    for (let i = 0; i < popSize; i++) {
      const sequence = Array(targetSequence.length)
        .fill(0)
        .map(() => bases[Math.floor(Math.random() * 4)])
        .join('');
      pop.push({
        sequence,
        fitness: calculateFitness(sequence)
      });
    }
    
    setPopulation(pop.sort((a, b) => b.fitness - a.fitness));
    setGeneration(0);
  };
  
  const calculateFitness = (sequence) => {
    let matches = 0;
    for (let i = 0; i < Math.min(sequence.length, targetSequence.length); i++) {
      if (sequence[i] === targetSequence[i]) matches++;
    }
    return matches / targetSequence.length;
  };
  
  const mutate = (sequence) => {
    const bases = ['A', 'T', 'C', 'G'];
    const purines = ['A', 'G'];
    const pyrimidines = ['C', 'T'];
    
    return sequence.split('').map(base => {
      if (Math.random() < mutationRate) {
        // Transition (more common): stay in same class
        if (Math.random() < 0.7) {
          const isPurine = purines.includes(base);
          const options = isPurine ? purines : pyrimidines;
          return options[Math.floor(Math.random() * options.length)];
        } else {
          // Transversion (less common): switch class
          return bases[Math.floor(Math.random() * 4)];
        }
      }
      return base;
    }).join('');
  };
  
  const evolveGeneration = () => {
    if (population.length === 0) return;
    
    // Selection: keep top 50%
    const survivors = population.slice(0, Math.ceil(population.length / 2));
    
    // Reproduction: survivors create offspring with mutation
    const newPop = [...survivors];
    while (newPop.length < 20) {
      const parent = survivors[Math.floor(Math.random() * survivors.length)];
      const child = mutate(parent.sequence);
      newPop.push({
        sequence: child,
        fitness: calculateFitness(child)
      });
    }
    
    setPopulation(newPop.sort((a, b) => b.fitness - a.fitness));
    setGeneration(g => g + 1);
  };
  
  useEffect(() => {
    if (isEvolving && population.length > 0) {
      const timer = setTimeout(() => {
        evolveGeneration();
        // Stop if we've reached the target
        if (population[0]?.fitness >= 1.0) {
          setIsEvolving(false);
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isEvolving, population, generation]);
  
  useEffect(() => {
    initializePopulation();
  }, [targetSequence]);

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gradient-to-br from-indigo-50 to-pink-50 min-h-screen">
      <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('origami')}
            className={`flex-1 py-4 px-6 font-semibold transition ${
              activeTab === 'origami'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Sparkles className="inline w-5 h-5 mr-2" />
            DNA Origami
          </button>
          <button
            onClick={() => setActiveTab('quaternary')}
            className={`flex-1 py-4 px-6 font-semibold transition ${
              activeTab === 'quaternary'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Cpu className="inline w-5 h-5 mr-2" />
            Quaternary Logic
          </button>
          <button
            onClick={() => setActiveTab('evolution')}
            className={`flex-1 py-4 px-6 font-semibold transition ${
              activeTab === 'evolution'
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Dna className="inline w-5 h-5 mr-2" />
            Evolution
          </button>
        </div>

        {/* DNA ORIGAMI TAB */}
        {activeTab === 'origami' && (
          <div className="p-6">
            <h2 className="text-3xl font-bold mb-4 text-blue-900">DNA Origami Designer</h2>
            <p className="text-gray-600 mb-6">
              DNA origami uses a long scaffold strand held in place by short staple strands
              to create programmable 2D and 3D nanostructures.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">Scaffold Length</label>
                <input
                  type="range"
                  min="6"
                  max="16"
                  value={scaffoldLength}
                  onChange={(e) => setScaffoldLength(Number(e.target.value))}
                  className="w-full"
                />
                <span className="text-sm text-gray-600">{scaffoldLength} bases</span>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Fold Pattern</label>
                <select
                  value={staplePattern}
                  onChange={(e) => setStaplePattern(e.target.value)}
                  className="w-full p-2 border-2 border-gray-300 rounded"
                >
                  <option value="box">Box (Rectangle)</option>
                  <option value="triangle">Triangle</option>
                  <option value="smiley">Smiley Face</option>
                </select>
              </div>
            </div>

            <div className="bg-gray-900 p-6 rounded-lg overflow-x-auto mb-6">
              <div className="font-mono text-sm space-y-1">
                {origamiGrid.map((row, r) => (
                  <div key={r} className="flex gap-1">
                    {row.map((cell, c) => (
                      <span
                        key={c}
                        className={`inline-block w-8 h-8 text-center leading-8 rounded ${
                          cell.type === 'scaffold'
                            ? 'bg-blue-600 text-white'
                            : cell.bound
                            ? 'bg-yellow-500 text-black'
                            : 'bg-gray-700 text-gray-400'
                        }`}
                      >
                        {cell.base}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-bold mb-2">How DNA Origami Works:</h3>
              <ul className="space-y-2 text-sm">
                <li>🔵 <strong>Blue bases:</strong> Scaffold strand (long, ~7000+ bases in real origami)</li>
                <li>🟡 <strong>Yellow bases:</strong> Staple strands (short, complementary sequences)</li>
                <li>⚫ <strong>Gray bases:</strong> Unbound scaffold regions</li>
                <li>📐 <strong>The magic:</strong> Staples pull scaffold into predetermined shapes</li>
                <li>🔬 <strong>Real applications:</strong> Drug delivery containers, molecular sensors, computing circuits</li>
              </ul>
            </div>
          </div>
        )}

        {/* QUATERNARY LOGIC TAB */}
        {activeTab === 'quaternary' && (
          <div className="p-6">
            <h2 className="text-3xl font-bold mb-4 text-purple-900">Quaternary (Base-4) Logic</h2>
            <p className="text-gray-600 mb-6">
              DNA has 4 bases, so why limit ourselves to binary? Quaternary logic uses A=0, T=1, C=2, G=3.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">Sequence 1</label>
                <input
                  type="text"
                  value={qSeq1}
                  onChange={(e) => setQSeq1(e.target.value.toUpperCase())}
                  className="w-full p-3 border-2 border-purple-300 rounded font-mono text-lg"
                />
                <span className="text-xs text-gray-600">Decimal: {seqToDecimal(qSeq1)}</span>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Sequence 2</label>
                <input
                  type="text"
                  value={qSeq2}
                  onChange={(e) => setQSeq2(e.target.value.toUpperCase())}
                  className="w-full p-3 border-2 border-pink-300 rounded font-mono text-lg"
                />
                <span className="text-xs text-gray-600">Decimal: {seqToDecimal(qSeq2)}</span>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Operation</label>
              <select
                value={qOperation}
                onChange={(e) => setQOperation(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded"
              >
                <option value="add">Quaternary Add (mod 4)</option>
                <option value="multiply">Quaternary Multiply (mod 4)</option>
                <option value="complement">Watson-Crick Complement</option>
                <option value="rotate">Cyclic Rotation (A→T→C→G→A)</option>
              </select>
            </div>

            <div className="bg-purple-100 p-6 rounded-lg mb-6">
              <h3 className="font-bold mb-3 text-lg">Result:</h3>
              <div className="bg-white p-4 rounded font-mono text-2xl text-center text-purple-900">
                {computeQuaternary()}
              </div>
              <div className="text-sm text-gray-700 mt-2 text-center">
                Decimal value: {seqToDecimal(computeQuaternary())}
              </div>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="font-bold mb-2">Quaternary Logic Examples:</h3>
              <div className="space-y-2 text-sm">
                <p><strong>Addition:</strong> ATCG + GCTA = (0123) + (3210) = (3333) mod 4 = GGGG</p>
                <p><strong>Storage advantage:</strong> Each base stores log₂(4) = 2 bits vs binary's 1 bit</p>
                <p><strong>Error correction:</strong> 4 symbols allow richer Reed-Solomon codes than binary</p>
                <p><strong>Biological meaning:</strong> Operations respect chemical properties (purines vs pyrimidines)</p>
              </div>
            </div>
          </div>
        )}

        {/* EVOLUTION TAB */}
        {activeTab === 'evolution' && (
          <div className="p-6">
            <h2 className="text-3xl font-bold mb-4 text-green-900">Evolutionary Simulation</h2>
            <p className="text-gray-600 mb-6">
              Watch a population of DNA sequences evolve toward a target through mutation and selection.
            </p>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">Target Sequence</label>
                <input
                  type="text"
                  value={targetSequence}
                  onChange={(e) => setTargetSequence(e.target.value.toUpperCase())}
                  className="w-full p-2 border-2 border-green-300 rounded font-mono"
                  disabled={isEvolving}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Mutation Rate</label>
                <input
                  type="range"
                  min="0.01"
                  max="0.5"
                  step="0.01"
                  value={mutationRate}
                  onChange={(e) => setMutationRate(Number(e.target.value))}
                  className="w-full"
                  disabled={isEvolving}
                />
                <span className="text-sm text-gray-600">{(mutationRate * 100).toFixed(0)}%</span>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Generation</label>
                <div className="text-3xl font-bold text-green-700">{generation}</div>
              </div>
            </div>

            <div className="flex gap-4 mb-6">
              <button
                onClick={() => setIsEvolving(!isEvolving)}
                className={`flex-1 py-3 px-6 rounded font-semibold ${
                  isEvolving
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {isEvolving ? 'Pause Evolution' : 'Start Evolution'}
              </button>
              
              <button
                onClick={initializePopulation}
                className="py-3 px-6 bg-gray-600 hover:bg-gray-700 text-white rounded font-semibold"
                disabled={isEvolving}
              >
                <RefreshCw className="inline w-5 h-5 mr-2" />
                Reset
              </button>
            </div>

            <div className="bg-green-50 p-6 rounded-lg mb-6">
              <h3 className="font-bold mb-3">Population (Top 10):</h3>
              <div className="space-y-2">
                {population.slice(0, 10).map((individual, i) => (
                  <div key={i} className="flex items-center gap-4 bg-white p-3 rounded">
                    <span className="font-bold text-gray-500 w-6">#{i + 1}</span>
                    <span className="font-mono text-lg flex-1">
                      {individual.sequence.split('').map((base, j) => (
                        <span
                          key={j}
                          className={
                            base === targetSequence[j]
                              ? 'text-green-600 font-bold'
                              : 'text-gray-400'
                          }
                        >
                          {base}
                        </span>
                      ))}
                    </span>
                    <div className="w-32 bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-green-600 h-4 rounded-full transition-all"
                        style={{ width: `${individual.fitness * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold w-12 text-right">
                      {(individual.fitness * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-green-100 p-4 rounded-lg">
              <h3 className="font-bold mb-2">Evolutionary Dynamics:</h3>
              <ul className="space-y-2 text-sm">
                <li>🧬 <strong>Mutations:</strong> Transitions (A↔G, C↔T) are 70% likely, transversions 30%</li>
                <li>🏆 <strong>Selection:</strong> Top 50% survive, create offspring for next generation</li>
                <li>📊 <strong>Fitness:</strong> Percentage of bases matching the target sequence</li>
                <li>⚡ <strong>Speed:</strong> Higher mutation rates explore faster but may miss the target</li>
                <li>🎯 <strong>Convergence:</strong> Watch as the population adapts to match the target!</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DNAOrigamiExplorer;