import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { TrendingUp, Zap, GitBranch, Activity } from 'lucide-react';

const AdvancedDNAEvolution = () => {
  const [targetSequence, setTargetSequence] = useState('GATTACA');
  const [populationSize, setPopulationSize] = useState(50);
  const [mutationRate, setMutationRate] = useState(0.15);
  const [selectionPressure, setSelectionPressure] = useState(0.5);
  const [generation, setGeneration] = useState(0);
  const [population, setPopulation] = useState([]);
  const [history, setHistory] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [mutationTypes, setMutationTypes] = useState({
    transitions: 0,
    transversions: 0,
    total: 0
  });
  
  const bases = ['A', 'T', 'C', 'G'];
  const purines = ['A', 'G'];
  const pyrimidines = ['C', 'T'];
  
  const initPopulation = () => {
    const pop = [];
    for (let i = 0; i < populationSize; i++) {
      const sequence = Array(targetSequence.length)
        .fill(0)
        .map(() => bases[Math.floor(Math.random() * 4)])
        .join('');
      pop.push({
        id: i,
        sequence,
        fitness: calcFitness(sequence),
        age: 0,
        lineage: [sequence]
      });
    }
    setPopulation(pop);
    setGeneration(0);
    setHistory([{
      gen: 0,
      avgFitness: pop.reduce((s, i) => s + i.fitness, 0) / pop.length,
      maxFitness: Math.max(...pop.map(i => i.fitness)),
      diversity: calcDiversity(pop),
      bestSequence: pop.sort((a, b) => b.fitness - a.fitness)[0].sequence
    }]);
    setMutationTypes({ transitions: 0, transversions: 0, total: 0 });
  };
  
  const calcFitness = (seq) => {
    let score = 0;
    for (let i = 0; i < Math.min(seq.length, targetSequence.length); i++) {
      if (seq[i] === targetSequence[i]) score++;
    }
    // Bonus for consecutive matches (simulates functional domains)
    let consecutive = 0;
    let maxConsecutive = 0;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] === targetSequence[i]) {
        consecutive++;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      } else {
        consecutive = 0;
      }
    }
    return (score / targetSequence.length) + (maxConsecutive / targetSequence.length) * 0.1;
  };
  
  const calcDiversity = (pop) => {
    const unique = new Set(pop.map(i => i.sequence));
    return unique.size / pop.length;
  };
  
  const mutate = (sequence) => {
    let newSeq = sequence.split('');
    let transitionCount = 0;
    let transversionCount = 0;
    
    for (let i = 0; i < newSeq.length; i++) {
      if (Math.random() < mutationRate) {
        const oldBase = newSeq[i];
        const isOldPurine = purines.includes(oldBase);
        
        // 70% chance of transition (stay in same class)
        // 30% chance of transversion (switch class)
        if (Math.random() < 0.7) {
          // Transition
          const options = isOldPurine ? purines : pyrimidines;
          newSeq[i] = options[Math.floor(Math.random() * options.length)];
          if (newSeq[i] !== oldBase) transitionCount++;
        } else {
          // Transversion
          const options = isOldPurine ? pyrimidines : purines;
          newSeq[i] = options[Math.floor(Math.random() * options.length)];
          transversionCount++;
        }
      }
    }
    
    setMutationTypes(prev => ({
      transitions: prev.transitions + transitionCount,
      transversions: prev.transversions + transversionCount,
      total: prev.total + transitionCount + transversionCount
    }));
    
    return newSeq.join('');
  };
  
  const evolve = () => {
    if (population.length === 0) return;
    
    // Fitness-proportionate selection (roulette wheel)
    const totalFitness = population.reduce((s, i) => s + Math.pow(i.fitness, 2), 0);
    
    const selectParent = () => {
      let rand = Math.random() * totalFitness;
      for (const ind of population) {
        rand -= Math.pow(ind.fitness, 2);
        if (rand <= 0) return ind;
      }
      return population[population.length - 1];
    };
    
    // Create new generation
    const newPop = [];
    const eliteCount = Math.floor(populationSize * (1 - selectionPressure) * 0.2);
    
    // Elitism: keep best individuals
    const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
    for (let i = 0; i < eliteCount; i++) {
      newPop.push({
        ...sorted[i],
        age: sorted[i].age + 1
      });
    }
    
    // Fill rest with mutated offspring
    while (newPop.length < populationSize) {
      const parent = selectParent();
      const childSeq = mutate(parent.sequence);
      newPop.push({
        id: Math.random(),
        sequence: childSeq,
        fitness: calcFitness(childSeq),
        age: 0,
        lineage: [...parent.lineage.slice(-5), childSeq]
      });
    }
    
    // Update state
    const newGen = generation + 1;
    const avgFit = newPop.reduce((s, i) => s + i.fitness, 0) / newPop.length;
    const maxFit = Math.max(...newPop.map(i => i.fitness));
    const div = calcDiversity(newPop);
    const best = newPop.sort((a, b) => b.fitness - a.fitness)[0];
    
    setPopulation(newPop);
    setGeneration(newGen);
    setHistory(prev => [...prev, {
      gen: newGen,
      avgFitness: avgFit,
      maxFitness: maxFit,
      diversity: div,
      bestSequence: best.sequence
    }]);
    
    // Auto-stop if perfect fitness reached
    if (maxFit >= 1.0) {
      setIsRunning(false);
    }
  };
  
  useEffect(() => {
    initPopulation();
  }, [targetSequence, populationSize]);
  
  useEffect(() => {
    if (isRunning) {
      const timer = setTimeout(evolve, speed);
      return () => clearTimeout(timer);
    }
  }, [isRunning, generation, population]);
  
  const getBaseColor = (base, isCorrect) => {
    if (isCorrect) {
      return base === 'A' ? 'text-green-600' :
             base === 'T' ? 'text-blue-600' :
             base === 'C' ? 'text-purple-600' :
             'text-orange-600';
    }
    return 'text-gray-300';
  };

  return (
    <div className="max-w-7xl mx-auto p-6 bg-gradient-to-br from-emerald-50 to-cyan-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-2xl p-6 mb-6">
        <h1 className="text-4xl font-bold mb-2 text-emerald-900">
          Advanced DNA Evolution Simulator
        </h1>
        <p className="text-gray-600 mb-6">
          Observe natural selection, mutation dynamics, and genetic drift in real-time
        </p>
        
        {/* Controls */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">Target Sequence</label>
            <input
              type="text"
              value={targetSequence}
              onChange={(e) => setTargetSequence(e.target.value.toUpperCase())}
              className="w-full p-2 border-2 border-emerald-300 rounded font-mono"
              disabled={isRunning}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">
              Population Size: {populationSize}
            </label>
            <input
              type="range"
              min="20"
              max="200"
              value={populationSize}
              onChange={(e) => setPopulationSize(Number(e.target.value))}
              className="w-full"
              disabled={isRunning}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">
              Mutation Rate: {(mutationRate * 100).toFixed(1)}%
            </label>
            <input
              type="range"
              min="0.01"
              max="0.5"
              step="0.01"
              value={mutationRate}
              onChange={(e) => setMutationRate(Number(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">
              Selection Pressure: {(selectionPressure * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.1"
              value={selectionPressure}
              onChange={(e) => setSelectionPressure(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
        
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold text-white ${
              isRunning
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isRunning ? 'Pause' : 'Start'} Evolution
          </button>
          
          <button
            onClick={evolve}
            disabled={isRunning}
            className="py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            Step Forward
          </button>
          
          <button
            onClick={initPopulation}
            disabled={isRunning}
            className="py-3 px-6 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            Reset
          </button>
          
          <div className="flex items-center gap-2">
            <label className="text-sm">Speed:</label>
            <input
              type="range"
              min="10"
              max="500"
              step="10"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-32"
            />
          </div>
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-emerald-100 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <Activity className="w-5 h-5 text-emerald-700 mr-2" />
              <span className="font-semibold text-emerald-900">Generation</span>
            </div>
            <div className="text-3xl font-bold text-emerald-700">{generation}</div>
          </div>
          
          <div className="bg-blue-100 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <TrendingUp className="w-5 h-5 text-blue-700 mr-2" />
              <span className="font-semibold text-blue-900">Max Fitness</span>
            </div>
            <div className="text-3xl font-bold text-blue-700">
              {history.length > 0 ? (history[history.length - 1].maxFitness * 100).toFixed(1) : 0}%
            </div>
          </div>
          
          <div className="bg-purple-100 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <GitBranch className="w-5 h-5 text-purple-700 mr-2" />
              <span className="font-semibold text-purple-900">Diversity</span>
            </div>
            <div className="text-3xl font-bold text-purple-700">
              {history.length > 0 ? (history[history.length - 1].diversity * 100).toFixed(1) : 0}%
            </div>
          </div>
          
          <div className="bg-orange-100 p-4 rounded-lg">
            <div className="flex items-center mb-2">
              <Zap className="w-5 h-5 text-orange-700 mr-2" />
              <span className="font-semibold text-orange-900">Mutations</span>
            </div>
            <div className="text-lg font-bold text-orange-700">
              Ti: {mutationTypes.transitions} / Tv: {mutationTypes.transversions}
            </div>
            <div className="text-xs text-orange-600">
              Ratio: {mutationTypes.transversions > 0 
                ? (mutationTypes.transitions / mutationTypes.transversions).toFixed(2) 
                : 'N/A'}
            </div>
          </div>
        </div>
      </div>
      
      {/* Fitness Over Time Chart */}
      <div className="bg-white rounded-xl shadow-2xl p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Fitness Evolution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="gen" label={{ value: 'Generation', position: 'insideBottom', offset: -5 }} />
            <YAxis label={{ value: 'Fitness', angle: -90, position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="maxFitness" stroke="#10b981" strokeWidth={3} name="Best Individual" />
            <Line type="monotone" dataKey="avgFitness" stroke="#3b82f6" strokeWidth={2} name="Population Average" />
            <Line type="monotone" dataKey="diversity" stroke="#8b5cf6" strokeWidth={2} name="Genetic Diversity" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* Population View */}
      <div className="bg-white rounded-xl shadow-2xl p-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Current Population (Top 15)</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {population
            .sort((a, b) => b.fitness - a.fitness)
            .slice(0, 15)
            .map((ind, i) => (
              <div key={ind.id} className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg hover:bg-gray-100 transition">
                <span className="font-bold text-gray-400 w-8">#{i + 1}</span>
                <div className="flex-1 font-mono text-lg">
                  {ind.sequence.split('').map((base, j) => (
                    <span
                      key={j}
                      className={`${getBaseColor(base, base === targetSequence[j])} font-bold`}
                    >
                      {base}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-32 bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-green-600 h-3 rounded-full transition-all"
                      style={{ width: `${ind.fitness * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold w-12 text-right">
                    {(ind.fitness * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-gray-500 w-16 text-right">
                    Age: {ind.age}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default AdvancedDNAEvolution;