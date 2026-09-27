from fastapi import FastAPI
from pydantic import BaseModel
from datetime import date, timedelta
import pandas as pd

app=FastAPI(title='BizMind AI Service',version='1.0.0')
class Point(BaseModel): date:str; quantity:float
class ForecastRequest(BaseModel): productId:int; history:list[Point]

def forecast_values(history,horizon=7):
    if not history:
        return [0]*horizon, 0.0
    df=pd.DataFrame([p.model_dump() for p in history]); df['date']=pd.to_datetime(df['date']); df=df.sort_values('date')
    df=df.groupby('date',as_index=False)['quantity'].sum()
    # Simple robust baseline for the MVP: recent weighted average + trend.
    values=df['quantity'].astype(float).tolist()
    if len(values)==1: base=values[-1]; trend=0
    else:
        window=values[-7:]; base=sum(window)/len(window); trend=(window[-1]-window[0])/max(1,len(window)-1)
    preds=[max(0,round(base+trend*(i+1),2)) for i in range(horizon)]
    confidence=min(0.95,0.45+0.05*min(len(values),10))
    return preds,round(confidence,2)

@app.get('/health')
def health(): return {'ok':True,'service':'BizMind AI'}
@app.post('/forecast')
def forecast(req:ForecastRequest):
    preds,confidence=forecast_values(req.history); start=date.today()+timedelta(days=1)
    return {'productId':req.productId,'forecast':[{'date':str(start+timedelta(days=i)),'predictedQuantity':q} for i,q in enumerate(preds)],'confidence':confidence,'method':'recent-average-plus-trend'}
